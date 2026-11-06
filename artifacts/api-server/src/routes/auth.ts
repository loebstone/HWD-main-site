import { Router } from "express";
import { eq } from "drizzle-orm";
import { sessions } from "@workspace/db";
import { RequestSignInBody, VerifySignInBody } from "@workspace/api-zod";
import { z } from "zod";
import { appOrigin, neutralMessage } from "../lib/config";
import { issueLink, normaliseEmail, verify, Refusal, identity, underlyingIdentity } from "../lib/auth";
import { audit } from "../lib/audit";
import { cookieOptions, visitorAddress, requireSession } from "../middlewares/security";
import { authAttempt, verificationEmail } from "../lib/auth-rate-limit";
import type { Services } from "../lib/services";
export function authRoutes(s: Services) {
  const router = Router();
  router.get("/verify", async (req, res): Promise<void> => {
    req.log.info({ forwardedFor: req.get("x-forwarded-for") ?? null,
      socketAddress: req.socket.remoteAddress ?? null, resolvedIp: req.ip ?? null,
      trustedProxyHops: req.app.get("trust proxy") }, "Verify proxy diagnostic");
    const email = await verificationEmail(s, req.query.token);
    await authAttempt(s, req, res, "verify", email);
    res.json({ message: "Choose Continue to sign in" });
  });
  router.post("/link", async (req, res): Promise<void> => {
    const neutral = () => res.json({ message: neutralMessage });
    try {
      const parsed = RequestSignInBody.safeParse(req.body);
      const value = parsed.success ? normaliseEmail(parsed.data.email) : undefined;
      const email = value && z.string().email().safeParse(value).success ? value : undefined;
      if (!await authAttempt(s, req, res, "link", email)) { neutral(); return; }
      if (email) await issueLink(s, email, appOrigin());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign-in refused";
      req.log.warn(message.includes("is unset") ? message : "Roster or email unavailable; sign-in refused");
    }
    neutral();
  });
  router.post("/verify", async (req, res): Promise<void> => {
    try {
      const email = await verificationEmail(s, req.body?.token);
      if (!await authAttempt(s, req, res, "verify", email)) {
        res.json({ error: "This sign-in link is invalid or expired. Request a new link." }); return;
      }
      const parsed = VerifySignInBody.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid sign-in link. Request a new link." }); return; }
      const result = await verify(s, parsed.data.token, visitorAddress(req));
      if (!process.env.BOOTSTRAP_PERSON_ID) req.log.warn("BOOTSTRAP_PERSON_ID is unset; initial admin grant disabled");
      res.cookie("site_session", result.raw, { ...cookieOptions(), expires: result.session.expiresAt });
      res.json(result.identity);
    } catch (error) {
      req.log.warn(error instanceof Error && error.message.includes("is unset") ? error.message : "Sign-in verification refused");
      res.status(error instanceof Refusal ? 401 : 503).json({ error: error instanceof Refusal
        ? error.message : "Sign-in is unavailable. Please request a new link later." });
    }
  });
  router.use(requireSession(s));
  router.get("/session", (req, res) => { res.json(req.siteIdentity); });
  // The only staff-related operation permitted during member view is switching
  // this same session back. Always re-authorize against the actual role, not input.
  router.post("/view-as-member", async (req, res): Promise<void> => {
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const result = await s.db.transaction(async tx => {
      const [current] = await tx.select().from(sessions).where(eq(sessions.hash, req.siteSession!.hash)).for("update");
      if (!current || current.endedAt) return null;
      const scoped = { ...s, db: tx as unknown as Services["db"] };
      const actor = await underlyingIdentity(scoped, current);
      if (actor.role !== "admin") return null;
      if (current.viewAsMember === enabled) return identity(scoped, current);
      const [updated] = await tx.update(sessions).set({ viewAsMember: enabled })
        .where(eq(sessions.hash, current.hash)).returning();
      await audit(tx, actor, enabled ? "view-as-member-on" : "view-as-member-off", null,
        `View as member ${enabled ? "on" : "off"}`, visitorAddress(req));
      return identity(scoped, updated!);
    });
    if (!result) { res.status(403).json({ error: "Administrator access required" }); return; }
    res.json(result);
  });
  router.post("/sign-out", async (req, res): Promise<void> => {
    await s.db.transaction(async tx => {
      await audit(tx, req.siteIdentity!, "sign-out", null, "Signed out", visitorAddress(req));
      await tx.delete(sessions).where(eq(sessions.hash, req.siteSession!.hash));
    });
    res.clearCookie("site_session", cookieOptions());
    res.json({ message: "Signed out" });
  });
  return router;
}
