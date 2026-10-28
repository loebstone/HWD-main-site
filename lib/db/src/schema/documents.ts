import { pgTable, text, timestamp, uuid, integer, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const documents = pgTable("site_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  section: text("section", { enum: ["shareholders", "directors", "governing", "logging", "photo_archive"] }).notNull(),
  year: integer("year"),
  type: text("type", { enum: ["pdf", "link"] }).notNull(),
  storageKey: text("storage_key"),
  externalUrl: text("external_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  note: text("note").notNull().default(""),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedByName: text("uploaded_by_name").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  replaces: uuid("replaces").references((): AnyPgColumn => documents.id),
}, (t) => [
  check("site_document_year", sql`${t.section} NOT IN ('shareholders','directors') OR ${t.year} IS NOT NULL`),
  check("site_document_storage", sql`(${t.type}='pdf' AND ${t.storageKey} IS NOT NULL AND ${t.externalUrl} IS NULL) OR (${t.type}='link' AND ${t.externalUrl} IS NOT NULL AND ${t.storageKey} IS NULL)`),
]);
