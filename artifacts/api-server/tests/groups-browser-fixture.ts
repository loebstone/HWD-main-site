// Explicit opt-in browser fixture. Isolated schema and synthetic identities only.
// Run with tsx; stop with SIGTERM. Never starts against production.
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { pool, sessions, documents, documentGroups } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { createApp } from "../src/app";
import { hashToken, newToken } from "../src/lib/auth";
import { installDatabaseProtections } from "../src/install-security";
import { DEFAULT_GROUPS, migrateDocumentGroups } from "../src/migrate-document-groups";
import type { Services } from "../src/lib/services";

if (process.env.NODE_ENV === "production") throw new Error("Browser fixtures are development-only");
process.env.NODE_ENV = "development";
process.env.APP_ORIGIN = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const host = new URL(process.env.DATABASE_URL!).hostname;
console.info("Browser fixture environment: development; configured database host before query:", host);
const schemaName = `hwd_group_browser_${randomUUID().replace(/-/g, "")}`;
const control = await pool.connect();
console.info("Observed database:", (await control.query("SELECT current_database() AS database, inet_server_addr()::text AS address")).rows);
await control.query(`CREATE SCHEMA "${schemaName}"`);
await control.query(`SET search_path TO "${schemaName}"`);
for (const table of ["site_login_tokens", "site_sessions", "site_grants", "site_document_groups", "site_data_migrations",
  "site_documents", "site_audit_log", "site_rate_limits", "site_announcements", "site_settings"]) {
  await control.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
}
const fixturePool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schemaName}` });
const fixtureDb = drizzle(fixturePool, { schema });
await installDatabaseProtections(fixturePool);
await migrateDocumentGroups(fixturePool);
const now = new Date();
const cookies: Record<string, string> = {};
for (const role of ["admin", "member", "editor"] as const) {
  const raw = newToken();
  cookies[role] = `site_session=${raw}`;
  await fixtureDb.insert(sessions).values({
    hash: hashToken(raw), personId: `synthetic-group-browser-${role}`, displayName: `Synthetic, ${role === "admin" ? "Morgan" : "Alex"}`,
    goesBy: role === "admin" ? "Morgan" : null, email: `${role}@example.invalid`, signInMethod: "roster", rosterRole: role,
    rosterApps: role === "member" ? ["forecast"] : role === "editor" ? [] : null,
    authenticatedAt: now, createdAt: now, expiresAt: new Date(now.getTime() + 30 * 86400000),
    lastRenewedAt: now, lastRosterCheckAt: now, lastRosterSuccessAt: now,
  });
}
const bytes = new Map<string, Buffer>();
const pdf = Buffer.from("%PDF-1.7\n1 0 obj <</Type /Catalog>> endobj\n%%EOF\n");
for (const [index, group] of DEFAULT_GROUPS.entries()) {
  await fixtureDb.update(documentGroups).set({ description: ["Minutes and records of the shareholders.", "Minutes and records of the directors.",
    "The Farm's agreements, policies and reference documents.", "Forest management records and reports.", "Family albums and photographs."][index] }).where(eq(documentGroups.id, group.id));
  for (const year of (group.layout === "by_year" ? [2025, 2026] : [2026])) {
    const key = randomUUID(); bytes.set(key, pdf);
    await fixtureDb.insert(documents).values({ title: `${year} ${group.section === "shareholders" || group.section === "directors" ? "Spring meeting minutes" : "Reference record"}`,
      section: group.section, groupId: group.id, year, type: "pdf", storageKey: key,
      uploadedBy: "synthetic-fixture", uploadedByName: "Synthetic Fixture", uploadedAt: new Date(`2026-10-${10 + index}T12:00:00Z`),
      sortOrder: 1, note: "Synthetic browser-check document — not a family record." });
  }
}
const services: Partial<Services> = {
  db: fixtureDb, roster: async email => ({ allowed: true, personId: `synthetic-group-browser-${email.split("@")[0]}`, displayName: "Synthetic Person", goes_by: null }),
  storage: { async save(data) { const key = randomUUID(); bytes.set(key, data); return key; },
    async read(key) { if (!bytes.has(key)) throw new Error("Synthetic file missing"); return Readable.from(bytes.get(key)!); } },
};
const server = createApp(services).listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Fixture listener failed");
await writeFile("/tmp/hwd-groups-browser-fixture.json", JSON.stringify({
  apiOrigin: `http://127.0.0.1:${address.port}`, cookies, schema: schemaName, host,
  pid: process.pid,
  frontendOrigin: `https://${process.env.REPLIT_DEV_DOMAIN}`,
}));
console.info("GROUP_BROWSER_FIXTURE_READY", address.port, schemaName, "pid", process.pid);
await new Promise<void>(resolve => { process.once("SIGTERM", resolve); process.once("SIGINT", resolve); });
await new Promise<void>(resolve => server.close(() => resolve()));
await fixturePool.end();
await control.query("RESET search_path");
await control.query(`DROP SCHEMA "${schemaName}" CASCADE`);
control.release();
await pool.end();
