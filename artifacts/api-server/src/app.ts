import express, { type Express, type ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ZodError } from "zod";
import { desc, isNull, sql } from "drizzle-orm";
import { documents } from "@workspace/db";
import { logger } from "./lib/logger";
import { defaultServices, type Services } from "./lib/services";
import { authRoutes } from "./routes/auth";
import { documentRoutes } from "./routes/documents";
import { grantRoutes } from "./routes/grants";
import { announcementRoutes } from "./routes/announcements";
import { auditRoutes } from "./routes/audit";
import { oldSiteImportRoutes } from "./routes/old-site-import";
import { adminSettingsRoutes, appLinkRoutes, publicHomeNoticeRoutes } from "./routes/settings";
import { csrf, requireSession } from "./middlewares/security";
import { publicDocument } from "./lib/documents";
import { getAppLinks, getHomeNotice, listAnnouncements } from "./lib/site-content";

export function createApp(services: Partial<Services> = {}): Express {
  const s = { ...defaultServices, ...services };
  const app = express();
  // Replit terminates TLS at its reverse proxy. Trust only the immediate proxy, not arbitrary XFF chains.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'none'"], frameAncestors: ["'self'"], baseUri: ["'none'"], formAction: ["'self'"],
  } }, crossOriginResourcePolicy: { policy: "same-origin" } }));
  app.use(pinoHttp({ logger, serializers: {
    req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
    res(res) { return { statusCode: res.statusCode }; },
  } }));
  app.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  app.use(cookieParser());
  app.use(express.json({ limit: "64kb" }));
  app.use(csrf());
  app.get("/api/healthz", (_req, res) => { res.json({ status: "ok" }); });
  app.use("/api/auth", authRoutes(s));
  app.use("/api/public/home-notice", publicHomeNoticeRoutes(s));
  // All remaining API routes fail closed before route lookup or file access.
  app.use("/api", requireSession(s));
  app.use("/api/apps", appLinkRoutes(s));
  app.use("/api/announcements", announcementRoutes(s));
  app.use("/api/documents", documentRoutes(s));
  app.use("/api/admin/grants", grantRoutes(s));
  app.use("/api/admin/audit", auditRoutes(s));
  app.use("/api/admin/old-site-import", oldSiteImportRoutes(s));
  app.use("/api/admin", adminSettingsRoutes(s));
  app.get("/api/home", async (req, res): Promise<void> => {
    const [count] = await s.db.select({ value: sql<number>`count(*)::integer` }).from(documents).where(isNull(documents.retiredAt));
    const recent = await s.db.select().from(documents).where(isNull(documents.retiredAt)).orderBy(desc(documents.uploadedAt)).limit(5);
    const [notice, reminders, allApps] = await Promise.all([
      getHomeNotice(s), listAnnouncements(s, { placement: "reminders" }), getAppLinks(s),
    ]);
    const apps = req.siteIdentity?.role === "admin" ? allApps
      : allApps.filter(app => app.id === "calendar" || app.id === "roster");
    res.json({ documentCount: count?.value ?? 0, recentDocuments: recent.map(publicDocument),
      notice, reminders: reminders.slice(0, 5), apps });
  });
  app.use((_req, res) => { res.status(404).json({ error: "Not found" }); });
  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    if (res.headersSent) { res.destroy(); return; }
    const message = error instanceof Error ? error.message : "";
    const status = error?.code === "LIMIT_FILE_SIZE" ? 413
      : error instanceof ZodError || error instanceof SyntaxError || error?.type === "entity.parse.failed" ||
        error?.name === "MulterError" || /Year is required|Invalid |is required|Use replace|last administrator/.test(message) ? 400 : 503;
    req.log.warn({ errorType: error?.name ?? "Error" }, message.includes("is unset") ? message : "Request refused");
    res.status(status).json({ error: status === 413 ? "PDF must be no larger than 50 MB"
      : status === 400 ? "Invalid request. Check the supplied fields." : "This feature is temporarily unavailable." });
  };
  app.use(errorHandler);
  return app;
}
export default createApp();
