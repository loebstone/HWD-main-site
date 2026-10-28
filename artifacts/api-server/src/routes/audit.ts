import { Router } from "express";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLog } from "@workspace/db";
import { requireAdmin } from "../middlewares/security";
import type { Services } from "../lib/services";

const actions = ["sign-in", "sign-out", "document-open", "document-upload", "document-replace",
  "document-retire", "grant-create", "grant-end", "announcement-create", "announcement-edit",
  "announcement-retire", "notice-edit", "apps-edit", "import"] as const;

export function auditRoutes(s: Services) {
  const router = Router();
  router.use(requireAdmin);
  router.get("/", async (req, res): Promise<void> => {
    const query = z.object({
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      personId: z.string().trim().max(100).optional(),
      action: z.enum(actions).optional(),
    }).parse(req.query);
    const filters = [
      ...(query.personId ? [eq(auditLog.actorPersonId, query.personId)] : []),
      ...(query.action ? [eq(auditLog.action, query.action)] : []),
    ];
    const where = filters.length ? and(...filters) : undefined;
    const pageSize = 50;
    const [totalRow] = await s.db.select({ value: count() }).from(auditLog).where(where);
    const items = await s.db.select().from(auditLog).where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id)).limit(pageSize).offset((query.page - 1) * pageSize);
    res.json({ items, page: query.page, pageSize, total: Number(totalRow?.value ?? 0) });
  });
  return router;
}
