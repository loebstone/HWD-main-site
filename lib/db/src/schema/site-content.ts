import { date, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const instant = (name: string) => timestamp(name, { withTimezone: true });

export const announcements = pgTable("site_announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  legacySheetId: text("legacy_sheet_id").unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  date: date("announcement_date", { mode: "string" }).notNull(),
  placement: text("placement", { enum: ["reminders", "announcements", "both"] }).notNull(),
  hideAfter: date("hide_after", { mode: "string" }).notNull(),
  createdBy: text("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
  retiredAt: instant("retired_at"),
});

export const siteSettings = pgTable("site_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

export type Announcement = typeof announcements.$inferSelect;
export type SiteSetting = typeof siteSettings.$inferSelect;
