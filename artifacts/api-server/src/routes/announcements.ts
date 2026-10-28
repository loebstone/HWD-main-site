import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { CreateAnnouncementBody, UpdateAnnouncementBody } from "@workspace/api-zod";
import { announcements } from "@workspace/db";
import { announcementInputSchema, listAnnouncements } from "../lib/site-content";
import { audit } from "../lib/audit";
import { requireEditor, visitorAddress } from "../middlewares/security";
import type { Services } from "../lib/services";

const idSchema = z.string().uuid();
function input(value: unknown, generated: typeof CreateAnnouncementBody | typeof UpdateAnnouncementBody) {
  const parsed = generated.parse(value) as Record<string, unknown>;
  const dateString = (date: unknown) => date instanceof Date ? date.toISOString().slice(0, 10) : date;
  return announcementInputSchema.parse({
    title: parsed.title, body: parsed.body, date: dateString(parsed.date),
    placement: parsed.placement, hideAfter: dateString(parsed.hideAfter),
  });
}

export function announcementRoutes(s: Services) {
  const router = Router();
  router.get("/", async (req, res): Promise<void> => {
    const raw = req.query.showPast;
    if (raw !== undefined && raw !== "true" && raw !== "false") {
      res.status(400).json({ error: "Invalid showPast value" }); return;
    }
    res.json(await listAnnouncements(s, { showPast: raw === "true" }));
  });

  router.use(requireEditor);
  router.post("/", async (req, res): Promise<void> => {
    const values = input(req.body, CreateAnnouncementBody);
    const actor = req.siteIdentity!;
    const row = await s.db.transaction(async tx => {
      const [created] = await tx.insert(announcements).values({ ...values,
        createdBy: actor.personId, createdByName: actor.goesBy || actor.displayName }).returning();
      await audit(tx, actor, "announcement-create", created!.id, "Created an announcement", visitorAddress(req));
      return created!;
    });
    res.status(201).json(row);
  });
  router.patch("/:id", async (req, res): Promise<void> => {
    const id = idSchema.parse(req.params.id);
    const values = input(req.body, UpdateAnnouncementBody);
    const row = await s.db.transaction(async tx => {
      const [updated] = await tx.update(announcements).set(values)
        .where(and(eq(announcements.id, id), isNull(announcements.retiredAt))).returning();
      if (!updated) return null;
      await audit(tx, req.siteIdentity!, "announcement-edit", id, "Edited an announcement", visitorAddress(req));
      return updated;
    });
    if (!row) { res.status(404).json({ error: "Announcement not found" }); return; }
    res.json(row);
  });
  router.post("/:id/retire", async (req, res): Promise<void> => {
    const id = idSchema.parse(req.params.id);
    const endedAt = s.now();
    const retired = await s.db.transaction(async tx => {
      const [row] = await tx.update(announcements).set({ retiredAt: endedAt })
        .where(and(eq(announcements.id, id), isNull(announcements.retiredAt))).returning();
      if (!row) return false;
      await audit(tx, req.siteIdentity!, "announcement-retire", id, "Retired an announcement; history retained", visitorAddress(req));
      return true;
    });
    if (!retired) { res.status(404).json({ error: "Announcement not found" }); return; }
    res.json({ message: "Announcement retired" });
  });
  return router;
}
