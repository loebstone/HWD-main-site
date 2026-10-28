import { Router } from "express";
import { eq } from "drizzle-orm";
import { sessions } from "@workspace/db";
import { RequestSignInBody, VerifySignInBody } from "@workspace/api-zod";
import { z } from "zod";
import { appOrigin, neutralMessage } from "../lib/config";
import { issueLink, normaliseEmail, verify, Refusal } from "../lib/auth";
import { audit } from "../lib/audit";
import { cookieOptions, visitorAddress, withinLimit, requireSession } from "../middlewares/security";
import type { Services } from "../lib/services";
export function authRoutes(s: Services) {
  const router = Router();
  router.get("/verify", async (req, res): Promise<void> => {
    if (!await withinLimit(s, "verify-ip", visitorAddress(req), 10, 900)) {
      res.status(429).json({ error: "Too many attempts. Please wait 15 minutes." }); return;
    }
    res.json({ message: "Choose Continue to sign in" });
  });
  router.post("/link", async (req, res): Promise<void> => {
    const neutral = () => res.json({ message: neutralMessage });
    try {
      const parsed = RequestSignInBody.safeParse(req.body);
      if (!parsed.success) { neutral(); return; }
      const email = normaliseEmail(parsed.data.email);
      if (!z.string().email().safeParse(email).success) { neutral(); return; }
      const [ipOK, emailOK] = await Promise.all([
        withinLimit(s, "link-ip", visitorAddress(req), 5, 900),
        withinLimit(s, "link-email", email, 3, 3600),
      ]);
      // Neutral for allowed, denied, unreachable, malformed and throttled.
      if (ipOK && emailOK) await issueLink(s, email, appOrigin());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign-in refused";
      req.log.warn(message.includes("is unset") ? message : "Roster or email unavailable; sign-in refused");
    }
    neutral();
  });
  router.post("/verify", async (req, res): Promise<void> => {
    try {
      if (!await withinLimit(s, "verify-ip", visitorAddress(req), 10, 900)) {
        res.status(429).json({ error: "Too many attempts. Please wait 15 minutes." }); return;
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
