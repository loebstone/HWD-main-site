import { pool } from "@workspace/db";
import type { Pool } from "pg";
import { logger } from "./lib/logger";

export const DEFAULT_GROUPS = [
  { id: "10000000-0000-4000-8000-000000000001", section: "shareholders", name: "Shareholders' meetings", slug: "shareholders-meetings", layout: "by_year" },
  { id: "10000000-0000-4000-8000-000000000002", section: "directors", name: "Directors' meetings", slug: "directors-meetings", layout: "by_year" },
  { id: "10000000-0000-4000-8000-000000000003", section: "governing", name: "Governing docs & policies", slug: "governing-docs-policies", layout: "list" },
  { id: "10000000-0000-4000-8000-000000000004", section: "logging", name: "Logging", slug: "logging", layout: "list" },
  { id: "10000000-0000-4000-8000-000000000005", section: "photo_archive", name: "Photo archive", slug: "photo-archive", layout: "list" },
] as const;

// Additive, atomic and recorded: never changes legacy section, IDs, bytes, retirement or versions.
export async function migrateDocumentGroups(target: Pool = pool) {
  const connection = await target.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(74202002)");
    const existing = await connection.query("SELECT details FROM site_data_migrations WHERE key = 'document-groups'");
    if (!existing.rowCount) {
      const before = await connection.query("SELECT count(*)::int AS count FROM site_documents");
      const assignments = await connection.query("SELECT id,section,group_id AS previous_group_id FROM site_documents ORDER BY id");
      for (const [index, group] of DEFAULT_GROUPS.entries()) {
        await connection.query(`INSERT INTO site_document_groups (id,name,slug,sort_order,layout,visibility,created_by)
          VALUES ($1,$2,$3,$4,$5,'everyone','system:document-groups-migration') ON CONFLICT (id) DO NOTHING`,
        [group.id, group.name, group.slug, index, group.layout]);
        await connection.query("UPDATE site_documents SET group_id=$1 WHERE section=$2 AND group_id IS NULL", [group.id, group.section]);
      }
      const unassigned = await connection.query("SELECT count(*)::int AS count FROM site_documents WHERE group_id IS NULL");
      const after = await connection.query("SELECT count(*)::int AS count FROM site_documents");
      if (unassigned.rows[0].count !== 0 || before.rows[0].count !== after.rows[0].count) {
        throw new Error("Document group migration refused: document count or assignment mismatch");
      }
      const counts = await connection.query(`SELECT g.id,g.name,count(d.id)::int AS total,
        count(d.id) FILTER (WHERE d.retired_at IS NULL)::int AS live
        FROM site_document_groups g LEFT JOIN site_documents d ON d.group_id=g.id
        GROUP BY g.id ORDER BY g.sort_order,g.name`);
      const details = { total: after.rows[0].count, unassigned: 0, groups: counts.rows, originalAssignments: assignments.rows };
      await connection.query("INSERT INTO site_data_migrations(key,details) VALUES ('document-groups',$1)", [JSON.stringify(details)]);
      logger.info(details, "Document groups migration recorded");
    }
    // Keep group_id nullable permanently: Publish applies the development schema
    // before this backfill can run. New uploads/moves require a group in the API.
    await connection.query("COMMIT");
    return existing.rows[0]?.details ?? (await connection.query("SELECT details FROM site_data_migrations WHERE key='document-groups'")).rows[0].details;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally { connection.release(); }
}
