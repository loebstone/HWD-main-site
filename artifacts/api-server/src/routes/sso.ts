import { Router, type Response } from "express";
import { createSession } from "../lib/auth";
import { returnPath, rosterEntry, rosterSignOut } from "../lib/sso";
import { cookieOptions, visitorAddress, withinLimit } from "../middlewares/security";
import type { Services } from "../lib/services";

const refused = (res: Response, status = 401) => res.status(status).type("html").send(
  '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Sign-in refused — HWD Farm</title><body><main><p>That sign-in link has expired or was already used. Start again from the Farm site.</p>' +
  '<a href="/sign-in"><button type="button">Back to sign-in</button></a></main></body></html>');

export function ssoRoutes(s: Services) {
  const router = Router();
  router.get("/sso", async (req, res): Promise<void> => {
    if (!await withinLimit(s, "sso-ip", visitorAddress(req), 20, 900)) { refused(res, 429); return; }
    let to: string;
    try { to = returnPath(req.query.to); } catch { refused(res, 400); return; }
    const ticket = req.query.ticket;
    if (typeof ticket !== "string" || !ticket || ticket.length > 4096) { refused(res); return; }
    try {
      const person = await s.redeemTicket(ticket);
      if (!person) { refused(res); return; }
      const result = await createSession(s, person, visitorAddress(req), person);
      res.cookie("site_session", result.raw, { ...cookieOptions(), expires: result.session.expiresAt });
      res.redirect(303, to);
    } catch {
      req.log.warn("Roster ticket redemption unavailable or refused; sign-in refused");
      refused(res);
    }
  });
  return router;
}

export function ssoEntryRoutes() {
  const router = Router();
  router.get("/roster-entry", (req, res): void => {
    try { res.json({ url: rosterEntry(req.query.to) }); }
    catch { res.status(400).json({ error: "Invalid return path or Roster sign-in configuration unavailable." }); }
  });
  router.get("/roster-sign-out", (_req, res): void => {
    try { res.json({ url: rosterSignOut() }); }
    catch { res.status(503).json({ error: "Roster sign-out configuration unavailable." }); }
  });
  return router;
}
