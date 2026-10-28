import { Router } from "express";
import { sql } from "drizzle-orm";
import { siteSettings } from "@workspace/db";
import { UpdateSuiteMenuBody } from "@workspace/api-zod";
import { requireAdmin, visitorAddress } from "../middlewares/security";
import { audit } from "../lib/audit";
import { getSuiteMenu, suiteCorsOrigin, suiteMenuInput } from "../lib/suite-menu";
import type { Services } from "../lib/services";

export function publicSuiteMenuRoutes(s: Services) {
  const router = Router();
  router.use(async (req, res, next): Promise<void> => {
    if (req.path !== "/") { next(); return; }
    if (!["GET", "OPTIONS"].includes(req.method)) {
      res.setHeader("Allow", "GET, OPTIONS"); res.status(405).json({ error: "GET only" }); return;
    }
    res.vary("Origin");
    const origin = req.get("origin");
    const menu = await getSuiteMenu(s);
    if (origin) {
      if (!suiteCorsOrigin(origin, menu)) { res.status(403).json({ error: "Origin not allowed" }); return; }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET");
      // No credentials: this payload is identical for everyone.
    }
    if (req.method === "OPTIONS") {
      if (req.get("access-control-request-method") !== "GET" || req.get("access-control-request-headers")) {
        res.status(403).json({ error: "Only a public GET is allowed" }); return;
      }
      res.status(204).end(); return;
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(menu);
  });
  return router;
}

export function adminSuiteMenuRoutes(s: Services) {
  const router = Router();
  router.use(requireAdmin);
  router.get("/", async (_req, res) => { res.json(await getSuiteMenu(s)); });
  router.put("/", async (req, res): Promise<void> => {
    const result = suiteMenuInput.safeParse(UpdateSuiteMenuBody.parse(req.body));
    if (!result.success) {
      res.status(400).json({ error: result.error.issues.map(issue => issue.message).join("; ") }); return;
    }
    await s.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(74202004)`);
      const previous = await getSuiteMenu({ ...s, db: tx as unknown as Services["db"] });
      const value = { ...result.data, version: previous.version + 1 };
      await tx.insert(siteSettings).values({ key: "suite-menu", value,
        updatedBy: req.siteIdentity!.personId, updatedAt: s.now() })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value,
          updatedBy: req.siteIdentity!.personId, updatedAt: s.now() } });
      await audit(tx, req.siteIdentity!, "menu-edit", "suite-menu", "Updated suite navigation", visitorAddress(req));
    });
    res.json(await getSuiteMenu(s));
  });
  return router;
}
