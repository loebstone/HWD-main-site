import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrateDocumentGroups, DEFAULT_GROUPS } from "../src/migrate-document-groups";
import { installDatabaseProtections } from "../src/install-security";

test("publish SQL applies to populated legacy tables before startup; all documents and other records survive", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  console.info("Environment: development; configured database host before query:", new URL(process.env.DATABASE_URL!).hostname);
  const isolated = `hwd_populated_${randomUUID().replaceAll("-", "")}`;
  const root = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const target = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${isolated}`, max: 2 });
  const tables = ["site_documents", "site_sessions", "site_announcements", "site_grants", "site_settings", "site_audit_log"];
  try {
    console.info("Observed database by query:", (await root.query("SELECT current_database() AS database, inet_server_addr()::text AS server_address")).rows[0]);
    await root.query(`CREATE SCHEMA "${isolated}"`);
    for (const table of tables) {
      await target.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    // Reconstruct the production schema observed read-only: no group_id or
    // roster_apps yet, section required, legacy year CHECK still present.
    await target.query("ALTER TABLE site_documents DROP COLUMN group_id");
    await target.query("ALTER TABLE site_documents ALTER COLUMN section SET NOT NULL");
    await target.query(`ALTER TABLE site_documents ADD CONSTRAINT site_document_year
      CHECK (section NOT IN ('shareholders','directors') OR year IS NOT NULL)`);
    await target.query("ALTER TABLE site_sessions DROP COLUMN roster_apps");
    await target.query("ALTER TABLE site_sessions DROP COLUMN view_as_member");
    for (let i = 0; i < 30; i++) {
      await target.query(`INSERT INTO site_documents
        (id,title,section,year,type,storage_key,external_url,uploaded_by,uploaded_by_name,retired_at,legacy_sheet_id,note,tags)
        VALUES ($1,$2,$3,2025,$4,$5,$6,'synthetic-importer','Synthetic Importer',$7,$8,'Preserve note',ARRAY['fixture'])`,
      [randomUUID(), `Synthetic legacy document ${i}`, DEFAULT_GROUPS[i % 5].section,
        i % 2 ? "link" : "pdf", i % 2 ? null : `private/synthetic-${i}`,
        i % 2 ? "https://example.invalid/" : null, i >= 24 ? new Date("2025-01-01Z") : null, `fixture-${i}`]);
    }
    await target.query(`UPDATE site_documents SET replaces=(SELECT id FROM site_documents WHERE title='Synthetic legacy document 24')
      WHERE title='Synthetic legacy document 0'`);
    await target.query(`INSERT INTO site_sessions(hash,person_id,display_name,email,expires_at)
      VALUES ('synthetic-hash','synthetic-person','Synthetic Person','nobody@example.invalid',now()+interval '30 days')`);
    await target.query(`INSERT INTO site_announcements(title,body,announcement_date,placement,hide_after,created_by,created_by_name)
      VALUES ('Synthetic announcement','Preserve body','2025-01-01','both','2025-03-02','synthetic-person','Synthetic Person')`);
    await target.query(`INSERT INTO site_grants(person_id,role,display_name,granted_by)
      VALUES ('synthetic-person','admin','Synthetic Person','synthetic-person')`);
    await target.query(`INSERT INTO site_settings(key,value,updated_by) VALUES ('synthetic-setting','{"keep":true}','synthetic-person')`);
    await target.query(`INSERT INTO site_audit_log(actor_person_id,actor_name,action,description,visitor_address)
      VALUES ('synthetic-person','Synthetic Person','sign-in','Preserve audit row','192.0.2.1')`);
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of tables) {
        result[table] = (await target.query(`SELECT to_jsonb(t)-'group_id'-'roster_apps'-'view_as_member' AS row
          FROM "${table}" t ORDER BY (to_jsonb(t)-'group_id'-'roster_apps'-'view_as_member')::text`)).rows;
      }
      return result;
    };
    const before = await snapshot();
    const sql = await readFile(new URL("./fixtures/document-groups-publish.sql", import.meta.url), "utf8");
    for (const statement of sql.split(";")) {
      if (/ALTER TABLE[\s\S]*ADD COLUMN/i.test(statement)) {
        assert(!/\bNOT NULL\b/i.test(statement) || /\bDEFAULT\b/i.test(statement), statement);
      }
    }
    assert(!/ADD CONSTRAINT "site_live_document_group"/.test(sql));
    // Only adapt the explicit production schema qualifier to the isolated one.
    await target.query(sql.replaceAll('"public".', `"${isolated}".`));
    assert.equal((await target.query("SELECT view_as_member FROM site_sessions")).rows[0].view_as_member, false);
    assert.equal((await target.query("SELECT count(*)::int AS n FROM site_documents WHERE group_id IS NULL")).rows[0].n, 30);
    assert.deepEqual(await snapshot(), before);
    // Exact startup ordering: protections, then transactional data backfill.
    await installDatabaseProtections(target);
    const first = await migrateDocumentGroups(target);
    assert.equal(first.total, 30);
    assert.equal(first.unassigned, 0);
    assert.equal(first.groups.reduce((n: number, g: { live: number }) => n + g.live, 0), 24);
    assert(first.groups.every((g: { total: number }) => g.total === 6));
    for (const row of (await target.query("SELECT section,group_id FROM site_documents")).rows) {
      assert.equal(row.group_id, DEFAULT_GROUPS.find(g => g.section === row.section)!.id);
    }
    assert.deepEqual(await snapshot(), before, "All original metadata, versions, storage keys and other table rows survive");
    assert.deepEqual(await migrateDocumentGroups(target), first);
    assert.equal((await target.query("SELECT count(*)::int AS n FROM site_data_migrations")).rows[0].n, 1);
    assert.equal((await target.query(`SELECT count(*)::int AS n FROM pg_constraint
      WHERE conrelid='site_documents'::regclass AND conname='site_live_document_group'`)).rows[0].n, 0);
    console.info("Populated-schema evidence: 24 live + 6 retired retained; 6 assigned per group; 0 unassigned; rerun unchanged; all other rows preserved.");
  } finally {
    await target.end();
    await root.query(`DROP SCHEMA IF EXISTS "${isolated}" CASCADE`);
    await root.end();
  }
});
