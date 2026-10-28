import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
export const auditLog = pgTable("site_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorPersonId: text("actor_person_id").notNull(),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  targetId: text("target_id"),
  description: text("description").notNull(),
  visitorAddress: text("visitor_address").notNull(),
});
export const rateLimits = pgTable("site_rate_limits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
