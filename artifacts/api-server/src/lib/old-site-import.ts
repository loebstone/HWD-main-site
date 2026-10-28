import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { announcements, documents, siteSettings, type SiteIdentity } from "@workspace/db";
import type { OldSiteImportRow, OldSiteImportRun } from "@workspace/api-zod";
import { audit } from "./audit";
import { documentMetadata, insertNewDocument } from "./documents";
import { announcementInputSchema } from "./site-content";
import { fetchGoogle, fetchOldSitePdf, googleUrl, OLD_SITE_INDEX, parseOldSiteCsv, type SheetRow } from "./old-site-fetch";
import { logger } from "./logger";
import type { Services } from "./services";
import { DEFAULT_GROUPS } from "../migrate-document-groups";

export const IMPORT_SETTING = "old-site-import-last-run";
const LEASE_MS = 120_000;
type Reader = Pick<Services["db"], "select">;

export function planOldSiteRow(row: SheetRow, now: Date) {
  const title = row.title?.trim() ?? "";
  const type = row.type?.trim().toLowerCase() ?? "";
  const section = row.section?.trim().toLowerCase() ?? "";
  const skip = (reason: string) => ({ kind: "skip" as const, section, reason });
  if (!row.id?.trim()) throw new Error("sheet id missing");
  if (row.id.length > 250) throw new Error("sheet id is too long");
  if (!title) throw new Error("title missing");
  if (/address/i.test(title) && /list/i.test(title)) return skip("address master list lives in the Roster");
  if (type === "google_sheet" && /scheduling|season/i.test(title)) return skip("scheduling sheet lives in the Scheduler");
  if (type === "google_calendar") return skip("calendar now lives in the Scheduler");
  if (section === "property") return skip("property items now live in the Scheduler");
  if (type === "announcement") {
    if (section !== "reminders" && section !== "home_highlight") throw new Error("unsupported announcement section");
    const date = row.publish_date || now.toISOString().slice(0, 10);
    const meta = announcementInputSchema.parse({ title, body: row.announcement_text ?? "", date,
      placement: section === "reminders" ? "reminders" : "announcements" });
    return { kind: "announcement" as const, section: meta.placement, meta,
      reason: `Announcement; hide after ${meta.hideAfter}${row.publish_date ? "" : `; blank date uses ${date}`}` };
  }
  if (!["google_doc", "google_sheet", "pdf", "link"].includes(type)) throw new Error(`unsupported type: ${type || "(blank)"}`);
  const original = row.open_url || row.embed_url;
  if (!original) throw new Error("source URL missing");
  const url = type === "link" ? new URL(original) : null;
  const smugmug = url && (url.hostname === "smugmug.com" || url.hostname.endsWith(".smugmug.com"));
  const mappedSection = type === "link" && (section === "photo_archive" || smugmug)
    ? "photo_archive" : section === "home_highlight" ? "governing" : section;
  let year: number | null = null;
  if (row.year) {
    if (!/^\d{4}$/.test(row.year)) throw new Error("invalid year");
    year = Number(row.year);
  } else if (["shareholders", "directors"].includes(mappedSection)) {
    const match = title.match(/\b\d{4}\b/);
    if (!match) throw new Error("year missing");
    year = Number(match[0]);
  }
  const sortOrder = /^-?\d+$/.test(row.sort_order ?? "") && Number.isSafeInteger(Number(row.sort_order))
    ? Number(row.sort_order) : 1;
  const group = DEFAULT_GROUPS.find(group => group.section === mappedSection);
  if (!group) throw new Error("unsupported document section");
  const meta = documentMetadata({ title, groupId: group.id, section: mappedSection, year, type: type === "link" ? "link" : "pdf",
    externalUrl: type === "link" ? url!.href : null, sortOrder,
    tags: (row.tags ?? "").split(",").map(tag => tag.trim()).filter(Boolean), note: row.supporting_text ?? "" });
  if (type === "link") return { kind: "document" as const, section: group.section, meta, fetchUrl: null, confirm: false,
    reason: "Link document; supporting text preserved as note" };
  // IDs come only from explicitly Google-hosted source URLs, never an arbitrary server URL.
  let id: string | null = null;
  for (const candidate of [row.open_url, row.embed_url].filter(Boolean)) {
    let parsed: URL;
    try { parsed = googleUrl(candidate!); } catch { continue; }
    id = parsed.pathname.match(/\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1] ??
      (type === "pdf" ? parsed.searchParams.get("id") : null);
    if (id && /^[a-zA-Z0-9_-]+$/.test(id)) break;
    id = null;
  }
  if (!id) throw new Error("Google file id missing");
  const fetchUrl = type === "google_doc" ? `https://docs.google.com/document/d/${id}/export?format=pdf`
    : type === "google_sheet" ? `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf`
    : `https://drive.google.com/uc?export=download&id=${id}`;
  return { kind: "document" as const, section: group.section, meta, fetchUrl, confirm: type === "pdf",
    reason: "Signature-validated PDF in private storage" };
}

async function alreadyImported(reader: Reader, sheetId: string) {
  const [doc] = await reader.select({ section: documents.section }).from(documents).where(eq(documents.legacySheetId, sheetId)).limit(1);
  if (doc) return doc;
  const [announcement] = await reader.select({ section: announcements.placement }).from(announcements)
    .where(eq(announcements.legacySheetId, sheetId)).limit(1);
  return announcement ?? null;
}

function reasonFor(error: unknown) {
  const message = error instanceof ZodError ? error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")
    : error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "Fetch timed out after 20 seconds"
    : error instanceof Error ? error.message : "Import failed";
  return message.replace(/[\r\n]+/g, " ").slice(0, 240);
}

export async function getOldSiteImport(s: Services): Promise<OldSiteImportRun | null> {
  const [setting] = await s.db.select().from(siteSettings).where(eq(siteSettings.key, IMPORT_SETTING));
  if (!setting) return null;
  const run = setting.value as OldSiteImportRun;
  if (run.status === "running" && s.now().getTime() - new Date(run.updatedAt).getTime() > LEASE_MS) {
    return { ...run, status: "interrupted", error: "Run interrupted; rerun safely to resume remaining sheet ids." };
  }
  return run;
}

async function persistRun(s: Services, run: OldSiteImportRun) {
  run.updatedAt = s.now().toISOString();
  const updated = await s.db.update(siteSettings).set({ value: structuredClone(run), updatedAt: s.now() })
    .where(and(eq(siteSettings.key, IMPORT_SETTING), sql`${siteSettings.value}->>'id' = ${run.id}`))
    .returning({ key: siteSettings.key });
  if (!updated.length) throw new Error("Import run was superseded");
}

export async function executeOldSiteImport(s: Services, actor: SiteIdentity, address: string, run: OldSiteImportRun) {
  try {
    const response = await fetchGoogle(OLD_SITE_INDEX, 2 * 1024 * 1024, s.importFetch);
    run.sourceHash = createHash("sha256").update(response.bytes).digest("hex");
    const source = parseOldSiteCsv(response.bytes.toString("utf8"));
    run.totalRows = source.length;
    await persistRun(s, run);
    const planned = new Map<string, string>();
    for (const row of source) {
      const report: OldSiteImportRow = { sheetId: row.id ?? "", title: row.title ?? "",
        section: row.section ?? "", result: "failed", reason: "" };
      try {
        const existing = row.id ? await alreadyImported(s.db, row.id) : null;
        if (row.id && (existing || planned.has(row.id))) {
          report.section = existing?.section ?? planned.get(row.id)!;
          report.result = "already imported"; report.reason = "Sheet id already recorded; no duplicate created";
        } else {
          const plan = planOldSiteRow(row, s.now());
          report.section = plan.section;
          report.reason = plan.reason;
          if (plan.kind === "skip") report.result = "skipped";
          else if (run.dryRun) {
            report.result = "would import";
            report.reason += plan.kind === "document" && plan.fetchUrl ? "; file not fetched or verified in dry run" : "";
            planned.set(row.id!, report.section);
          } else {
            const bytes = plan.kind === "document" && plan.fetchUrl
              ? await fetchOldSitePdf(plan.fetchUrl, plan.confirm, s.importFetch) : undefined;
            report.result = await s.db.transaction(async tx => {
              // Cross-table serialization also prevents duplicates if a source row changes type.
              await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"old-site:" + row.id}, 0))`);
              if (await alreadyImported(tx, row.id!)) return "already imported" as const;
              let targetId: string;
              if (plan.kind === "announcement") {
                const [created] = await tx.insert(announcements).values({ ...plan.meta, legacySheetId: row.id,
                  createdBy: actor.personId, createdByName: actor.displayName, createdAt: s.now() }).returning();
                targetId = created!.id;
                await audit(tx, actor, "announcement-create", targetId, "Imported announcement from old site", address);
              } else {
                const created = await insertNewDocument(s, tx, actor, address, plan.meta, bytes, row.id);
                targetId = created.id;
              }
              await audit(tx, actor, "import", targetId, `Import from old site: ${row.id}`, address);
              return "imported" as const;
            });
            if (report.result === "already imported") report.reason = "Sheet id recorded by another run; no duplicate created";
          }
        }
      } catch (error) { report.result = "failed"; report.reason = reasonFor(error); }
      run.rows.push(report);
      await persistRun(s, run);
    }
    run.status = "completed";
  } catch (error) {
    run.status = "failed"; run.error = reasonFor(error);
    logger.warn({ runId: run.id, reason: run.error }, "Old-site import stopped");
  }
  run.finishedAt = s.now().toISOString();
  await persistRun(s, run);
  return run;
}

export class ImportBusyError extends Error {}
export async function startOldSiteImport(s: Services, actor: SiteIdentity, address: string, dryRun: boolean) {
  const now = s.now().toISOString();
  const run: OldSiteImportRun = { id: randomUUID(), dryRun, status: "running", startedAt: now, updatedAt: now,
    finishedAt: null, actorPersonId: actor.personId, actorName: actor.displayName, totalRows: 0, rows: [], error: null, sourceHash: null };
  await s.db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(74202002)`);
    const [last] = await tx.select().from(siteSettings).where(eq(siteSettings.key, IMPORT_SETTING));
    const previous = last?.value as OldSiteImportRun | undefined;
    if (previous?.status === "running" && s.now().getTime() - new Date(previous.updatedAt).getTime() <= LEASE_MS) {
      throw new ImportBusyError("An import or dry run is already in progress");
    }
    await tx.insert(siteSettings).values({ key: IMPORT_SETTING, value: structuredClone(run),
      updatedBy: actor.personId, updatedAt: s.now() })
      .onConflictDoUpdate({ target: siteSettings.key, set: { value: structuredClone(run), updatedBy: actor.personId, updatedAt: s.now() } });
  });
  // Persist progress between rows, and keep long-running Google fetches outside the HTTP request.
  setImmediate(() => {
    void executeOldSiteImport(s, actor, address, run).catch(error =>
      logger.error({ runId: run.id, reason: reasonFor(error) }, "Could not persist old-site import completion"));
  });
  return structuredClone(run);
}
