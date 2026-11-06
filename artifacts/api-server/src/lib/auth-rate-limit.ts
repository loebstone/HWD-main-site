import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { loginTokens } from "@workspace/db";
import { hashToken, normaliseEmail } from "./auth";
import { consumeLimit, rateIdentifierHash, visitorAddress } from "../middlewares/security";
import type { Services } from "./services";

export const AUTH_WINDOW_SECONDS = 900;
export const AUTH_ADDRESS_LIMIT = 8;
export const AUTH_EMAIL_LIMIT = 3;

// Never accept an email supplied with a verification request: only the stored
// token owner may determine that key. Read-only lookup does not consume tokens.
export async function verificationEmail(s: Services, token: unknown) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return undefined;
  const [row] = await s.db.select({ email: loginTokens.email }).from(loginTokens)
    .where(eq(loginTokens.hash, hashToken(token))).limit(1);
  return row ? normaliseEmail(row.email) : undefined;
}

export async function authAttempt(s: Services, req: Request, res: Response, kind: "link" | "verify",
  email?: string): Promise<boolean> {
  const address = visitorAddress(req);
  const ip = await consumeLimit(s, `${kind}-ip`, address, AUTH_ADDRESS_LIMIT, AUTH_WINDOW_SECONDS);
  // An already-blocked address must not create unlimited per-email rows.
  // New namespace avoids inheriting the previous one-hour email windows.
  const mail = ip.allowed && email
    ? await consumeLimit(s, `${kind}-email-15m`, normaliseEmail(email), AUTH_EMAIL_LIMIT, AUTH_WINDOW_SECONDS) : undefined;
  if (ip.allowed && (!mail || mail.allowed)) return true;
  const retryAfter = Math.max(ip.allowed ? 0 : ip.retryAfter, mail && !mail.allowed ? mail.retryAfter : 0);
  res.setHeader("Retry-After", String(retryAfter));
  res.status(429);
  req.log.info({ addressHash: rateIdentifierHash(address), route: `/api/auth/${kind}`,
    count: ip.count, emailCount: mail?.count ?? null, addressThrottled: !ip.allowed, emailThrottled: mail ? !mail.allowed : false },
  "Authentication attempt throttled");
  return false;
}
