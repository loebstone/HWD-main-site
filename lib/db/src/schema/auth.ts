import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const time = (name: string) => timestamp(name, { withTimezone: true });
export const loginTokens = pgTable("site_login_tokens", {
  hash: text("hash").primaryKey(),
  personId: text("person_id").notNull(),
  displayName: text("display_name").notNull(),
  goesBy: text("goes_by"),
  email: text("email").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  expiresAt: time("expires_at").notNull(),
  usedAt: time("used_at"),
});
export const sessions = pgTable("site_sessions", {
  hash: text("hash").primaryKey(),
  personId: text("person_id").notNull(),
  displayName: text("display_name").notNull(),
  goesBy: text("goes_by"),
  email: text("email").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  expiresAt: time("expires_at").notNull(),
  lastRenewedAt: time("last_renewed_at").notNull().defaultNow(),
  authenticatedAt: time("authenticated_at"),
  signInMethod: text("sign_in_method", { enum: ["magic-link", "roster"] }).notNull().default("magic-link"),
  rosterRole: text("roster_role", { enum: ["member", "editor", "admin"] }),
  lastRosterCheckAt: time("last_roster_check_at").notNull().defaultNow(),
  lastRosterSuccessAt: time("last_roster_success_at").notNull().defaultNow(),
  endedAt: time("ended_at"),
});
export const grants = pgTable("site_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: text("person_id").notNull(),
  role: text("role", { enum: ["editor", "admin"] }).notNull(),
  displayName: text("display_name").notNull(),
  grantedBy: text("granted_by").notNull(),
  grantedAt: time("granted_at").notNull().defaultNow(),
  endedAt: time("ended_at"),
}, (t) => [uniqueIndex("site_one_active_grant").on(t.personId).where(sql`${t.endedAt} IS NULL`)]);
export type SiteSession = typeof sessions.$inferSelect;
export type SiteIdentity = {
  personId: string; displayName: string; goesBy: string | null; role: "member" | "editor" | "admin";
};
