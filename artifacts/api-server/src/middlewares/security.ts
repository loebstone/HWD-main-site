import { createHmac } from "node:crypto";
import type { RequestHandler, Request } from "express";
import { sql } from "drizzle-orm";
import { appOrigin, required } from "../lib/config";
import { identity, resolveSession } from "../lib/auth";
import type { Services } from "../lib/services";
import type { SiteIdentity, SiteSession } from "@workspace/db";

declare global {
  namespace Express {
    interface Request { siteIdentity?: SiteIdentity; siteSession?: SiteSession; }
  }
}
export const visitorAddress = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "unknown";
export const cookieOptions = () => ({
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/",
});
export function csrf(): RequestHandler {
  return (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || req.path === "/healthz") { next(); return; }
    const origin = req.get("origin");
    try {
      if (origin ? origin === appOrigin() && req.get("sec-fetch-site") !== "cross-site"
        : req.get("sec-fetch-site") === "same-origin") {
        next(); return;
      }
    } catch {
      req.log.warn("APP_ORIGIN is unset; browser write refused");
    }
    res.status(403).json({ error: "Write requests require same-origin browser headers" });
  };
}
export function requireSession(s: Services): RequestHandler {
  return async (req, res, next) => {
    const session = await resolveSession(s, req.cookies?.site_session);
    if (!session) {
      res.clearCookie("site_session", cookieOptions());
      res.status(401).json({ error: "Sign in to access HWD Farm" }); return;
    }
    req.siteSession = session;
    req.siteIdentity = await identity(s, session);
    if (req.path !== "/sign-out") {
      res.cookie("site_session", req.cookies.site_session, { ...cookieOptions(), expires: session.expiresAt });
    }
    next();
  };
}
export const requireEditor: RequestHandler = (req, res, next) => {
  if (req.siteIdentity?.role !== "editor" && req.siteIdentity?.role !== "admin") {
    res.status(403).json({ error: "Editor access required" }); return;
  }
  next();
};
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.siteIdentity?.role !== "admin") { res.status(403).json({ error: "Administrator access required" }); return; }
  next();
};
export function rateIdentifierHash(identifier: string) {
  const secret = required("SESSION_SECRET");
  return createHmac("sha256", secret).update(identifier).digest("hex");
}
export async function consumeLimit(s: Services, prefix: string, identifier: string, max: number, seconds: number) {
  const key = prefix + ":" + rateIdentifierHash(identifier);
  const result = await s.db.execute(sql`
    INSERT INTO site_rate_limits (key,hits,expires_at) VALUES (${key},1,now()+${seconds}*interval '1 second')
    ON CONFLICT (key) DO UPDATE SET
      hits=CASE WHEN site_rate_limits.expires_at <= now() THEN 1 ELSE site_rate_limits.hits+1 END,
      expires_at=CASE WHEN site_rate_limits.expires_at <= now() THEN now()+${seconds}*interval '1 second' ELSE site_rate_limits.expires_at END
    RETURNING hits, greatest(1,ceil(extract(epoch FROM expires_at-now()))) AS retry_after`);
  const count = Number(result.rows[0]?.hits);
  if (!Number.isFinite(count)) throw new Error("Rate-limit counter unavailable");
  return { allowed: count <= max, count, retryAfter: Number(result.rows[0]!.retry_after) };
}
export async function withinLimit(s: Services, prefix: string, identifier: string, max: number, seconds: number): Promise<boolean> {
  return (await consumeLimit(s, prefix, identifier, max, seconds)).allowed;
}
