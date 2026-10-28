import { Router } from "express";
import { StartOldSiteImportBody } from "@workspace/api-zod";
import { requireAdmin, visitorAddress } from "../middlewares/security";
import { getOldSiteImport, ImportBusyError, startOldSiteImport } from "../lib/old-site-import";
import type { Services } from "../lib/services";

export function oldSiteImportRoutes(s: Services) {
  const router = Router();
  router.use(requireAdmin);
  router.get("/", async (_req, res): Promise<void> => {
    const run = await getOldSiteImport(s);
    if (!run) { res.status(204).end(); return; }
    res.json(run);
  });
  router.post("/", async (req, res): Promise<void> => {
    const { dryRun } = StartOldSiteImportBody.parse(req.body);
    try {
      res.status(202).json(await startOldSiteImport(s, req.siteIdentity!, visitorAddress(req), dryRun));
    } catch (error) {
      if (error instanceof ImportBusyError) { res.status(409).json({ error: error.message }); return; }
      throw error;
    }
  });
  return router;
}
