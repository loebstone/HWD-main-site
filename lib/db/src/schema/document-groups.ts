import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const documentGroups = pgTable("site_document_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  layout: text("layout", { enum: ["list", "by_year"] }).notNull().default("list"),
  visibility: text("visibility", { enum: ["everyone", "staff"] }).notNull().default("everyone"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
});

export const dataMigrations = pgTable("site_data_migrations", {
  key: text("key").primaryKey(),
  details: jsonb("details").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});
