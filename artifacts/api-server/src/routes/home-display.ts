import { Router } from "express";
import { documents, siteSettings } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { audit } from "../lib/audit";
import { getDuesSettings, getHomeDisplay, homeDisplayInput, duesInput } from "../lib/home-display";
import { requireAdmin, visitorAddress } from "../middlewares/security";
import type { Services } from "../lib/services";
import { checkFamilyTime } from "../lib/family-time";

export function familyTimeCheckRoutes(s: Services) {
  const router = Router();
  router.use(requireAdmin);
  router.get("/check", async (_req, res) => {
    res.json(await checkFamilyTime(s));
  });
  return router;
}

export function homeDisplayRoutes(s: Services) {
  const router = Router();
  router.use(requireAdmin);
  router.get("/", async (_req, res) => { res.json(await getHomeDisplay(s)); });
  router.put("/", async (req, res): Promise<void> => {
    const parsed = homeDisplayInput.safeParse({ ...await getHomeDisplay(s), ...req.body });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map(issue => issue.message).join("; ") });
      return;
    }
    if (parsed.data.featuredLineMode === "chosen") {
      const [document] = await s.db.select({ id: documents.id }).from(documents)
        .where(and(eq(documents.id, parsed.data.featuredDocumentId!), isNull(documents.retiredAt))).limit(1);
      if (!document) { res.status(400).json({ error: "Choose a live document for the featured line." }); return; }
    }
    await s.db.transaction(async tx => {
      const values = { key: "home-display", value: parsed.data, updatedBy: req.siteIdentity!.personId, updatedAt: s.now() };
      await tx.insert(siteSettings).values(values).onConflictDoUpdate({ target: siteSettings.key, set: values });
      await audit(tx, req.siteIdentity!, "home-edit", "home-display", "Updated Home display settings", visitorAddress(req));
    });
    res.json(parsed.data);
  });
  return router;
}
export function adminDuesRoutes(s: Services) {
  const router = Router();
  router.use(requireAdmin);
  router.get("/", async (_req, res) => { res.json(await getDuesSettings(s)); });
  router.put("/", async (req, res) => {
    const input = duesInput.parse(req.body);
    await s.db.transaction(async tx => {
      const values = { key: "dues", value: input, updatedBy: req.siteIdentity!.personId, updatedAt: s.now() };
      await tx.insert(siteSettings).values(values).onConflictDoUpdate({ target: siteSettings.key, set: values });
      await audit(tx, req.siteIdentity!, "dues-settings-edit", "dues",
        `Updated dues settings; season ${input.seasonOpen ? "open" : "closed"}`, visitorAddress(req));
    });
    res.json(input);
  });
  return router;
}
export function duesRoutes(s: Services) {
  const router = Router();
  router.get("/", async (_req, res) => {
    const setting = await getDuesSettings(s);
    res.json({ seasonOpen: setting.seasonOpen, text: setting.seasonOpen ? setting.text : "" });
  });
  return router;
}
