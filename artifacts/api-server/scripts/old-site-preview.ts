// Read-only development preview when there is not yet a verified admin session.
// This never creates a session, grant, document, announcement or settings record.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pool, db, documents, announcements } from "@workspace/db";
import { sql } from "drizzle-orm";
import { OLD_SITE_INDEX, fetchGoogle, parseOldSiteCsv } from "../src/lib/old-site-fetch";
import { planOldSiteRow } from "../src/lib/old-site-import";
import type { OldSiteImportRow } from "@workspace/api-zod";

if (process.env.NODE_ENV === "production") throw new Error("Read-only preview script is development-only");
const host = new URL(process.env.DATABASE_URL!).hostname;
console.info(`Environment: development; configured database host confirmed before query: ${host}`);
try {
  const observed = await db.execute(sql`SELECT current_database() AS database, inet_server_addr() AS server_address`);
  console.info("Database observed by query:", observed.rows);
  const imported = new Map<string, string>();
  for (const row of await db.select().from(documents)) if (row.legacySheetId) imported.set(row.legacySheetId, row.section);
  for (const row of await db.select().from(announcements)) if (row.legacySheetId) imported.set(row.legacySheetId, row.placement);
  const source = await fetchGoogle(OLD_SITE_INDEX, 2 * 1024 * 1024);
  const rows: OldSiteImportRow[] = [];
  const now = new Date();
  for (const row of parseOldSiteCsv(source.bytes.toString("utf8"))) {
    const report: OldSiteImportRow = { sheetId: row.id ?? "", title: row.title ?? "", section: row.section ?? "", result: "failed", reason: "" };
    try {
      if (row.id && imported.has(row.id)) {
        report.section = imported.get(row.id)!; report.result = "already imported"; report.reason = "Sheet id already recorded";
      } else {
        const plan = planOldSiteRow(row, now);
        report.section = plan.section; report.reason = plan.reason;
        if (plan.kind === "skip") report.result = "skipped";
        else {
          report.result = "would import";
          if (plan.kind === "document" && plan.fetchUrl) report.reason += "; file not fetched or verified in dry run";
          imported.set(row.id!, plan.section);
        }
      }
    } catch (error) {
      report.reason = (error instanceof Error ? error.message : "Validation failed").replace(/[\r\n]+/g, " ").slice(0, 240);
    }
    rows.push(report);
  }
  const result = { environment: "development", configuredDatabaseHost: host, observedDatabase: observed.rows[0],
    dryRun: true, previewOnly: true, startedAt: now.toISOString(), sourceHash: createHash("sha256").update(source.bytes).digest("hex"),
    sourceFetches: 1, documentFetches: 0, rows };
  await mkdir("../../generated-artifacts", { recursive: true });
  await writeFile("../../generated-artifacts/old-site-live-dry-run.json", JSON.stringify(result, null, 2));
  console.info(JSON.stringify(result, null, 2));
} finally { await pool.end(); }
