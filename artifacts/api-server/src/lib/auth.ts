import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { grants, loginTokens, sessions, type SiteIdentity, type SiteSession } from "@workspace/db";
import { DAY, required } from "./config";
import { audit } from "./audit";
import type { Services } from "./services";
import { logger } from "./logger";
import { RosterUnavailableError, type RedeemedIdentity } from "./roster";

const HOUR = 60 * 60_000;
const ROSTER_OUTAGE_GRACE = 3 * DAY;

export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
export const normaliseEmail = (email: string) => email.trim().toLowerCase();
export class Refusal extends Error {}

export async function issueLink(s: Services, email: string, origin: string): Promise<void> {
  const answer = await s.roster(email);
  if (!answer.allowed) return;
  // Check mail configuration before persisting an unusable token.
  required("MAIL_FROM");
  const token = newToken();
  await s.db.insert(loginTokens).values({ hash: hashToken(token), personId: answer.personId,
    displayName: answer.displayName, goesBy: answer.goes_by, email,
    expiresAt: new Date(s.now().getTime() + 15 * 60_000) });
  await s.email(email, `${origin}/auth/continue?token=${token}`);
}

export async function identity(s: Services, session: SiteSession): Promise<SiteIdentity> {
  if (session.signInMethod === "roster") {
    if (!session.rosterRole) throw new Refusal("Invalid Roster session");
    return { personId: session.personId, displayName: session.displayName, goesBy: session.goesBy, role: session.rosterRole, apps: session.rosterApps };
  }
  const [grant] = await s.db.select().from(grants).where(and(eq(grants.personId, session.personId), isNull(grants.endedAt)));
  return { personId: session.personId, displayName: session.displayName, goesBy: session.goesBy, role: grant?.role ?? "member", apps: session.rosterApps };
}
export async function verify(s: Services, token: string, address: string) {
  required("SESSION_SECRET");
  const now = s.now();
  // Single atomic statement both reads and consumes. Never SELECT then UPDATE.
  const [login] = await s.db.update(loginTokens).set({ usedAt: now })
    .where(and(eq(loginTokens.hash, hashToken(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now))).returning();
  if (!login) throw new Refusal("This sign-in link is invalid or expired. Request a new link.");
  const answer = await s.roster(login.email);
  if (!answer.allowed || answer.personId !== login.personId) throw new Refusal("This sign-in link is no longer valid. Request a new link.");
  return createSession(s, { ...answer, email: login.email }, address);
}

export async function createSession(s: Services,
  answer: { personId: string; displayName: string; goes_by: string | null; email: string; apps?: string[] },
  address: string, roster?: RedeemedIdentity) {
  required("SESSION_SECRET");
  const now = s.now();
  const raw = newToken();
  const actor = { personId: answer.personId, displayName: answer.displayName };
  const row = await s.db.transaction(async (tx) => {
    if (!roster) {
      // Serializes the never-had-a-grant test against bootstrap AND admin grants.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(74201901)`);
      const [ever] = await tx.select({ id: grants.id }).from(grants).limit(1);
      if (!ever) {
        // Only the never-before-granted bootstrap administrator may use this exception.
        const bootstrap = process.env.BOOTSTRAP_PERSON_ID?.trim();
        if (bootstrap && bootstrap === answer.personId) {
          const [grant] = await tx.insert(grants).values({ personId: answer.personId, role: "admin",
            displayName: answer.displayName, grantedBy: answer.personId }).returning();
          await audit(tx, actor, "grant-create", grant!.id, "Initial administrator grant", address);
        }
      }
      const [admin] = await tx.select().from(grants).where(and(
        eq(grants.personId, answer.personId), eq(grants.role, "admin"), isNull(grants.endedAt)));
      if (!admin) throw new Refusal("Administrator access is required for this sign-in.");
    }
    const [session] = await tx.insert(sessions).values({ hash: hashToken(raw), ...actor,
      goesBy: answer.goes_by, email: normaliseEmail(answer.email), createdAt: now,
      signInMethod: roster ? "roster" : "magic-link",
      authenticatedAt: roster ? new Date(roster.authenticated_at) : now,
      rosterRole: roster?.role ?? null,
      rosterApps: roster?.apps ?? answer.apps ?? null,
      expiresAt: new Date(now.getTime() + 30 * DAY), lastRenewedAt: now,
      lastRosterCheckAt: now, lastRosterSuccessAt: now }).returning();
    await audit(tx, actor, "sign-in", null, roster ? "Signed in via Roster" : "Signed in using a single-use link", address);
    return session!;
  });
  return { raw, session: row, identity: await identity(s, row) };
}

export async function resolveSession(s: Services, raw: unknown): Promise<SiteSession | null> {
  if (typeof raw !== "string" || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const now = s.now();
  const [session] = await s.db.select().from(sessions).where(eq(sessions.hash, hashToken(raw)));
  if (!session || session.endedAt) return null;
  const maximum = new Date(session.createdAt); maximum.setUTCFullYear(maximum.getUTCFullYear() + 1);
  if (session.expiresAt <= now || maximum <= now) {
    await s.db.update(sessions).set({ endedAt: now }).where(eq(sessions.hash, session.hash));
    return null;
  }
  if (now.getTime() - session.lastRosterSuccessAt.getTime() >= ROSTER_OUTAGE_GRACE) {
    await s.db.update(sessions).set({ endedAt: now }).where(and(eq(sessions.hash, session.hash), isNull(sessions.endedAt)));
    return null;
  }
  const outageCheck = session.lastRosterCheckAt > session.lastRosterSuccessAt;
  const recheckAfter = outageCheck ? HOUR : DAY;
  if (now.getTime() - session.lastRosterCheckAt.getTime() >= recheckAfter) {
    // Hold row lock while checking so simultaneous requests make at most one Roster call.
    const checked = await s.db.transaction(async (tx) => {
      const [current] = await tx.select().from(sessions).where(eq(sessions.hash, session.hash)).for("update");
      if (!current || current.endedAt) return null;
      if (now.getTime() - current.lastRosterSuccessAt.getTime() >= ROSTER_OUTAGE_GRACE) {
        await tx.update(sessions).set({ endedAt: now }).where(eq(sessions.hash, current.hash));
        return null;
      }
      const currentOutage = current.lastRosterCheckAt > current.lastRosterSuccessAt;
      if (now.getTime() - current.lastRosterCheckAt.getTime() < (currentOutage ? HOUR : DAY)) return current;
      try {
        let answer;
        try {
          answer = await s.roster(current.email, 5_000);
        } catch (error) {
          if (!(error instanceof RosterUnavailableError)) throw error;
          answer = await s.roster(current.email, 8_000);
        }
        const allowed = answer.allowed && answer.personId === current.personId;
        const [updated] = await tx.update(sessions).set({ lastRosterCheckAt: now,
          ...(allowed && answer.allowed ? { lastRosterSuccessAt: now, rosterApps: answer.apps ?? null } : { endedAt: now }) })
          .where(eq(sessions.hash, current.hash)).returning();
        return allowed ? updated! : null;
      } catch (error) {
        if (!(error instanceof RosterUnavailableError)) {
          logger.warn(error instanceof Error && error.message.includes("is unset")
            ? error.message : "Roster returned an unexpected response; session ended");
          await tx.update(sessions).set({ lastRosterCheckAt: now, endedAt: now }).where(eq(sessions.hash, current.hash));
          return null;
        }
        const overdue = now.getTime() - current.lastRosterSuccessAt.getTime() >= ROSTER_OUTAGE_GRACE;
        logger.warn({ personId: current.personId, tolerated: !overdue }, "Roster recheck unavailable after retry");
        const [updated] = await tx.update(sessions).set({ lastRosterCheckAt: now,
          ...(overdue ? { endedAt: now } : {}) }).where(eq(sessions.hash, current.hash)).returning();
        return overdue ? null : updated!;
      }
    });
    if (!checked) return null;
    Object.assign(session, checked);
  }
  if (now.getTime() - session.lastRenewedAt.getTime() > DAY) {
    const expiresAt = new Date(Math.min(now.getTime() + 30 * DAY, maximum.getTime()));
    const [renewed] = await s.db.update(sessions).set({ expiresAt, lastRenewedAt: now })
      .where(and(eq(sessions.hash, session.hash), isNull(sessions.endedAt))).returning();
    if (!renewed) return null;
    return renewed;
  }
  return session;
}
