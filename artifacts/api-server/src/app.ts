import express, { type Express, type ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ZodError } from "zod";
import { asc, desc, inArray, isNull, sql } from "drizzle-orm";
import { documents } from "@workspace/db";
import { logger } from "./lib/logger";
import { defaultServices, type Services } from "./lib/services";
import { authRoutes } from "./routes/auth";
import { ssoRoutes, ssoEntryRoutes } from "./routes/sso";
import { documentRoutes } from "./routes/documents";
import { grantRoutes } from "./routes/grants";
import { announcementRoutes } from "./routes/announcements";
import { auditRoutes } from "./routes/audit";
import { oldSiteImportRoutes } from "./routes/old-site-import";
import { adminSettingsRoutes, appLinkRoutes, publicHomeNoticeRoutes } from "./routes/settings";
import { csrf, requireSession } from "./middlewares/security";
import { PROXY_TRUST } from "./lib/proxy-trust";
import { BUILD_ID } from "./lib/build-identity";
import { publicDocument } from "./lib/documents";
import { getAppLinks, getHomeNotice, listAnnouncements } from "./lib/site-content";
import { adminGroupRoutes, groupRoutes, homeGroupSettingsRoutes } from "./routes/document-groups";
import { getFeaturedGroupIds, GroupError, legacyGroupLocation, listGroups, visibleDocumentFilter } from "./lib/document-groups";
import { and } from "drizzle-orm";
import { adminSuiteMenuRoutes, publicSuiteMenuRoutes } from "./routes/suite-menu";
import { adminContactRoutes, contactRoutes } from "./routes/contact";
import { getSuiteMenu, toolAllowed } from "./lib/suite-menu";
import { getDuesSettings, getHomeDisplay } from "./lib/home-display";
import { getFamilyTime } from "./lib/family-time";
import { DEFAULT_GROUPS } from "./migrate-document-groups";
import { adminDuesRoutes, duesRoutes, homeDisplayRoutes } from "./routes/home-display";

export function createApp(services: Partial<Services> = {}): Express {
  const s = { ...defaultServices, ...services };
  const app = express();
  // Bounded startup configuration, counted from the right; never trust all.
  app.set("trust proxy", PROXY_TRUST.hops);
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
  // Public, identity-free navigation. Method/CORS gate precedes body parsing,
  // CSRF and sessions; it never sets a session cookie.
  app.use("/api/suite/menu", publicSuiteMenuRoutes(s));
  app.use(express.json({ limit: "64kb" }));
  app.use(csrf());
  app.get("/api/healthz", (_req, res) => { res.json({ status: "ok", build: BUILD_ID }); });
  app.use("/auth", ssoRoutes(s));
  app.use("/api/auth", ssoEntryRoutes());
  app.use("/api/auth", authRoutes(s));
  app.use("/api/public/home-notice", publicHomeNoticeRoutes(s));
  // Public redirects reveal only the destination, never document data.
  app.get(["/meetings", "/meetings/shareholders", "/meetings/directors", "/logging", "/governing", "/photo-archive"], async (req, res) => {
    const location = await legacyGroupLocation(s, req.path);
    res.redirect(301, location ?? "/documents");
  });
  // All remaining API routes fail closed before route lookup or file access.
  app.use("/api", requireSession(s));
  app.use("/api/apps", appLinkRoutes(s));
  app.use("/api/contact", contactRoutes(s));
  app.use("/api/admin/contact", adminContactRoutes(s));
  app.use("/api/admin/suite-menu", adminSuiteMenuRoutes(s));
  app.use("/api/announcements", announcementRoutes(s));
  app.use("/api/documents", documentRoutes(s));
  app.use("/api/groups", groupRoutes(s));
  app.use("/api/admin/groups", adminGroupRoutes(s));
  app.use("/api/admin/home", homeGroupSettingsRoutes(s));
  app.use("/api/admin/home-display", homeDisplayRoutes(s));
  app.use("/api/admin/dues", adminDuesRoutes(s));
  app.use("/api/dues", duesRoutes(s));
  app.use("/api/admin/grants", grantRoutes(s));
  app.use("/api/admin/audit", auditRoutes(s));
  app.use("/api/admin/old-site-import", oldSiteImportRoutes(s));
  app.use("/api/admin", adminSettingsRoutes(s));
  app.get("/api/home", async (req, res): Promise<void> => {
    const visible = and(isNull(documents.retiredAt), visibleDocumentFilter(s, req.siteIdentity!.role, false, true));
    const [count] = await s.db.select({ value: sql<number>`count(*)::integer` }).from(documents).where(visible);
    const recent = await s.db.select().from(documents).where(visible).orderBy(desc(documents.uploadedAt)).limit(5);
    const groups = await listGroups(s, req.siteIdentity!.role);
    const featuredIds = await getFeaturedGroupIds(s);
    const featuredGroups = featuredIds.flatMap(id => groups.find(g => g.id === id) ?? []);
    const [notice, reminders, allApps, menu, display, dues, minutes] = await Promise.all([
      getHomeNotice(s), listAnnouncements(s, { placement: "reminders" }), getAppLinks(s),
      getSuiteMenu(s), getHomeDisplay(s), getDuesSettings(s),
      s.db.select().from(documents).where(and(visible, inArray(documents.groupId, DEFAULT_GROUPS.slice(0, 2).map(g => g.id))))
        .orderBy(desc(documents.uploadedAt), asc(documents.title)).limit(1),
    ]);
    const apps = allApps.filter(app => app.id === "calendar" || app.id === "roster"
      || toolAllowed(req.siteIdentity!, app.id === "cap-table" ? "captable" : app.id));
    const cardItems = [
      { id: "scheduler", label: "Scheduler" }, { id: "directory", label: "Family Directory" },
      { id: "documents", label: "Documents" }, { id: "contact", label: "Contact" },
    ];
    const cards = cardItems.map(card => ({ ...card, href: menu.items.find(item => item.id === card.id)!.href }));
    for (const tool of menu.tools) {
      if (req.siteIdentity!.apps?.includes(tool.id) ||
        (tool.id === "captable" && req.siteIdentity!.apps?.includes("cap-table"))) cards.push(tool);
    }
    if (dues.seasonOpen) cards.push({ id: "dues", label: "Pay your dues", href: "/dues" });
    const familyTime = await getFamilyTime(s, req.siteSession!.email, req.siteIdentity!.personId,
      menu.items.find(item => item.id === "scheduler")!.href);
    res.json({ documentCount: count?.value ?? 0, recentDocuments: recent.map(publicDocument),
      notice, reminders: reminders.slice(0, 5), apps, featuredGroups,
      latestMinutes: minutes[0] ? publicDocument(minutes[0]) : null,
      slideshowEmbedUrl: display.slideshowEmbedUrl, familyTime, cards });
  });
  app.use((_req, res) => { res.status(404).json({ error: "Not found" }); });
  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    if (res.headersSent) { res.destroy(); return; }
    const message = error instanceof Error ? error.message : "";
    const databaseCode = error?.code ?? error?.cause?.code;
    const jsonTooLarge = error?.type === "entity.too.large";
    const status = error instanceof GroupError ? error.status : databaseCode === "23505" ? 409
      : jsonTooLarge || error?.code === "LIMIT_FILE_SIZE" ? 413
      : error instanceof ZodError || error instanceof SyntaxError || error?.type === "entity.parse.failed" ||
        error?.name === "MulterError" || /Year is required|Invalid |is required|Use replace|last administrator/.test(message) ? 400 : 503;
    req.log.warn({ errorType: error?.name ?? "Error" }, message.includes("is unset") ? message : "Request refused");
    res.status(status).json({ error: error instanceof GroupError ? error.message
      : databaseCode === "23505" ? "That slug or record already exists. Choose a unique slug."
      : jsonTooLarge ? "Request too large. JSON bodies must be no larger than 64 KB."
      : status === 413 ? "PDF must be no larger than 50 MB"
      : status === 400 ? "Invalid request. Check the supplied fields." : "This feature is temporarily unavailable." });
  };
  app.use(errorHandler);
  return app;
}
export default createApp();
