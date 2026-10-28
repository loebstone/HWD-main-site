import { Router } from "express";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { documentGroups, documents, siteSettings } from "@workspace/db";
import { audit } from "../lib/audit";
import { getFeaturedGroupIds, GroupError, groupInput, homeGroupsInput, listGroups, lockLiveGroup } from "../lib/document-groups";
import { publicDocument } from "../lib/documents";
import { requireAdmin, requireEditor, visitorAddress } from "../middlewares/security";
import type { Services } from "../lib/services";

export function groupRoutes(s: Services) {
  const router = Router();
  router.get("/", async (req, res) => { res.json(await listGroups(s, req.siteIdentity!.role)); });
  router.get("/:slug", async (req, res): Promise<void> => {
    const group = (await listGroups(s, req.siteIdentity!.role)).find(g => g.slug === req.params.slug);
    if (!group) { res.status(404).json({ error: "Group not found" }); return; }
    const rows = await s.db.select().from(documents).where(and(eq(documents.groupId, group.id), isNull(documents.retiredAt)))
      .orderBy(...(group.layout === "by_year" ? [sql`${documents.year} DESC NULLS LAST`] : []),
        asc(documents.sortOrder), asc(documents.title));
    res.json({ group, documents: rows.map(publicDocument) });
  });
  return router;
}

export function adminGroupRoutes(s: Services) {
  const router = Router();
  router.use(requireEditor);
  router.post("/", async (req, res) => {
    const input = groupInput.parse(req.body);
    const row = await s.db.transaction(async tx => {
      const [created] = await tx.insert(documentGroups).values({ ...input, createdBy: req.siteIdentity!.personId, createdAt: s.now() }).returning();
      await audit(tx, req.siteIdentity!, "group-create", created!.id, `Created document group: ${input.name}`, visitorAddress(req));
      return created!;
    });
    res.status(201).json({ ...row, documentCount: 0, latestTitle: null, latestDate: null });
  });
  router.patch("/:id", async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = groupInput.parse(req.body);
    await s.db.transaction(async tx => {
      await lockLiveGroup(tx, id);
      await tx.update(documentGroups).set(input).where(eq(documentGroups.id, id));
      await audit(tx, req.siteIdentity!, "group-edit", id, `Edited document group: ${input.name}`, visitorAddress(req));
    });
    res.json((await listGroups(s, req.siteIdentity!.role)).find(g => g.id === id));
  });
  router.post("/:id/retire", async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    await s.db.transaction(async tx => {
      const group = await lockLiveGroup(tx, id);
      const [live] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.groupId, id), isNull(documents.retiredAt))).limit(1);
      if (live) throw new GroupError("Move or retire all live documents before retiring this group", 409);
      await tx.update(documentGroups).set({ retiredAt: s.now() }).where(eq(documentGroups.id, id));
      await audit(tx, req.siteIdentity!, "group-retire", id, `Retired empty document group: ${group.name}`, visitorAddress(req));
    });
    res.json({ message: "Group retired; records retained" });
  });
  return router;
}

export function homeGroupSettingsRoutes(s: Services) {
  const router = Router();
  router.use(requireAdmin);
  router.get("/", async (_req, res) => { res.json({ groupIds: await getFeaturedGroupIds(s) }); });
  router.put("/", async (req, res) => {
    const input = homeGroupsInput.parse(req.body);
    await s.db.transaction(async tx => {
      for (const id of [...input.groupIds].sort()) await lockLiveGroup(tx, id);
      await tx.insert(siteSettings).values({ key: "home-groups", value: input, updatedBy: req.siteIdentity!.personId, updatedAt: s.now() })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value: input, updatedBy: req.siteIdentity!.personId, updatedAt: s.now() } });
      await audit(tx, req.siteIdentity!, "home-edit", "home-groups", "Updated featured document groups", visitorAddress(req));
    });
    res.json(input);
  });
  return router;
}
