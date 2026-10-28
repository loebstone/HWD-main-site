import { Router } from "express";
import { eq } from "drizzle-orm";
import { UpdateAppLinksBody, UpdateHomeNoticeBody } from "@workspace/api-zod";
import { siteSettings } from "@workspace/db";
import { audit } from "../lib/audit";
import { defaultAppLinks, defaultHomeNotice, getAppLinks, getHomeNotice, appLinksSchema, homeNoticeSchema } from "../lib/site-content";
import { requireAdmin, requireEditor, visitorAddress } from "../middlewares/security";
import type { Services } from "../lib/services";

const PUBLIC_APP_IDS = new Set(["calendar", "roster"]);

export function publicHomeNoticeRoutes(s: Services) {
  const router = Router();
  router.get("/", async (_req, res): Promise<void> => {
    const notice = await getHomeNotice(s);
    if (notice.visibility !== "public" || !notice.text.trim()) { res.status(204).end(); return; }
    res.json({ text: notice.text });
  });
  return router;
}

export function appLinkRoutes(s: Services) {
  const router = Router();
  router.get("/", async (req, res): Promise<void> => {
    const apps = await getAppLinks(s);
    res.json(req.siteIdentity?.role === "admin" ? apps : apps.filter(app => PUBLIC_APP_IDS.has(app.id)));
  });
  return router;
}

export function adminSettingsRoutes(s: Services) {
  const router = Router();
  router.get("/home-notice", requireEditor, async (_req, res): Promise<void> => {
    res.json(await getHomeNotice(s));
  });
  router.put("/home-notice", requireEditor, async (req, res): Promise<void> => {
    const notice = homeNoticeSchema.parse(UpdateHomeNoticeBody.parse(req.body));
    await s.db.transaction(async tx => {
      await tx.insert(siteSettings).values({ key: "home-notice", value: notice,
        updatedBy: req.siteIdentity!.personId, updatedAt: s.now() })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value: notice,
          updatedBy: req.siteIdentity!.personId, updatedAt: s.now() } });
      await audit(tx, req.siteIdentity!, "notice-edit", "home-notice", "Updated the home notice", visitorAddress(req));
    });
    res.json(notice);
  });
  router.get("/apps", requireAdmin, async (_req, res): Promise<void> => {
    res.json(await getAppLinks(s));
  });
  router.put("/apps", requireAdmin, async (req, res): Promise<void> => {
    const body = UpdateAppLinksBody.parse(req.body);
    const apps = appLinksSchema.parse(body.apps);
    await s.db.transaction(async tx => {
      await tx.insert(siteSettings).values({ key: "apps", value: apps,
        updatedBy: req.siteIdentity!.personId, updatedAt: s.now() })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value: apps,
          updatedBy: req.siteIdentity!.personId, updatedAt: s.now() } });
      await audit(tx, req.siteIdentity!, "apps-edit", "apps", "Updated Farm app links", visitorAddress(req));
    });
    res.json(apps);
  });
  return router;
}
