import { Router } from "express";
import { and, eq, isNull, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { grants } from "@workspace/db";
import { CreateGrantBody } from "@workspace/api-zod";
import { audit } from "../lib/audit";
import { requireAdmin, visitorAddress } from "../middlewares/security";
import type { Services } from "../lib/services";
export function grantRoutes(s: Services) {
  const router = Router();
  router.use(requireAdmin);
  router.get("/", async (_req, res): Promise<void> => {
    res.json(await s.db.select().from(grants).orderBy(desc(grants.grantedAt)));
  });
  router.post("/", async (req, res): Promise<void> => {
    const meta = CreateGrantBody.parse(req.body);
    const row = await s.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(74201901)`);
      const [prior] = await tx.select().from(grants).where(and(eq(grants.personId, meta.personId), isNull(grants.endedAt)));
      if (prior) return null;
      const [grant] = await tx.insert(grants).values({ ...meta, grantedBy: req.siteIdentity!.personId }).returning();
      await audit(tx, req.siteIdentity!, "grant-create", grant!.id, `Granted ${meta.role} access`, visitorAddress(req));
      return grant!;
    });
    if (!row) { res.status(409).json({ error: "End the existing grant before creating another" }); return; }
    res.status(201).json(row);
  });
  router.post("/:id/end", async (req, res): Promise<void> => {
    const id = z.string().uuid().parse(req.params.id);
    const ended = await s.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(74201901)`);
      const [grant] = await tx.select().from(grants).where(and(eq(grants.id, id), isNull(grants.endedAt)));
      if (!grant) return false;
      if (grant.role === "admin") {
        const admins = await tx.select({ id: grants.id }).from(grants).where(and(eq(grants.role, "admin"), isNull(grants.endedAt)));
        if (admins.length <= 1) return "last-admin" as const;
      }
      await tx.update(grants).set({ endedAt: s.now() }).where(eq(grants.id, id));
      await audit(tx, req.siteIdentity!, "grant-end", id, "Ended access grant; history retained", visitorAddress(req));
      return "ended" as const;
    });
    if (ended === "last-admin") { res.status(409).json({ error: "Cannot end the last administrator grant" }); return; }
    if (!ended) { res.status(404).json({ error: "Grant not found" }); return; }
    res.json({ message: "Grant ended" });
  });
  return router;
}
