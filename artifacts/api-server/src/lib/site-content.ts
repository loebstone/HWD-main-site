import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { announcements, siteSettings, type Announcement } from "@workspace/db";
import type { Services } from "./services";

export const appIds = ["calendar", "roster", "forecast", "cap-table"] as const;
export const appLinkSchema = z.object({
  id: z.enum(appIds),
  label: z.string().trim().min(1).max(100),
  url: z.string().url().max(2048).refine(value => new URL(value).protocol === "https:", "App links must use HTTPS"),
});
export const appLinksSchema = z.array(appLinkSchema).length(4).superRefine((apps, ctx) => {
  if (new Set(apps.map(app => app.id)).size !== 4) {
    ctx.addIssue({ code: "custom", message: "Each Farm app must appear exactly once" });
  }
});
export type AppLink = z.infer<typeof appLinkSchema>;

export const defaultAppLinks: AppLink[] = [
  { id: "calendar", label: "Calendar", url: "https://calendar.hwdfarm.com" },
  { id: "roster", label: "Roster", url: "https://roster.hwdfarm.com" },
  { id: "forecast", label: "Forecast", url: "https://forecast.hwdfarm.com" },
  { id: "cap-table", label: "Cap Table", url: "https://captable.hwdfarm.com" },
];
export const defaultHomeNotice = { text: "", visibility: "signed-in" as const };
export const homeNoticeSchema = z.object({
  text: z.string().max(10_000),
  visibility: z.enum(["signed-in", "public"]),
});
export type HomeNotice = z.infer<typeof homeNoticeSchema>;

const today = () => new Date().toISOString().slice(0, 10);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Date must be a real calendar date");
const afterDays = (date: string, days: number) => {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};
export const announcementInputSchema = z.object({
  title: z.string().trim().min(1).max(250),
  body: z.string().min(1).max(10_000),
  date: isoDateSchema.optional(),
  placement: z.enum(["reminders", "announcements", "both"]),
  hideAfter: isoDateSchema.optional(),
}).transform(value => {
  const date = value.date ?? today();
  return { ...value, date, hideAfter: value.hideAfter ?? afterDays(date, 60) };
}).superRefine((value, ctx) => {
  if (value.hideAfter < value.date) {
    ctx.addIssue({ code: "custom", path: ["hideAfter"], message: "Hide-after date must be on or after the announcement date" });
  }
});
export type AnnouncementInput = z.output<typeof announcementInputSchema>;

async function readSetting<T>(
  s: Services,
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  const [row] = await s.db.select().from(siteSettings).where(eq(siteSettings.key, key));
  if (!row) return fallback;
  const parsed = schema.safeParse(row.value);
  if (!parsed.success) throw new Error(`Saved ${key} settings are invalid`);
  return parsed.data;
}

export const getHomeNotice = (s: Services) =>
  readSetting(s, "home-notice", homeNoticeSchema, defaultHomeNotice);

export const getAppLinks = (s: Services) =>
  readSetting(s, "apps", appLinksSchema, defaultAppLinks);

export async function listAnnouncements(
  s: Services,
  options: { showPast?: boolean; placement?: "reminders" | "announcements" },
): Promise<Announcement[]> {
  const currentDate = today();
  const filters = [
    isNull(announcements.retiredAt),
    lte(announcements.date, currentDate),
    ...(options.showPast ? [] : [gte(announcements.hideAfter, currentDate)]),
    ...(options.placement
      ? [options.placement === "reminders"
        ? or(eq(announcements.placement, "reminders"), eq(announcements.placement, "both"))
        : or(eq(announcements.placement, "announcements"), eq(announcements.placement, "both"))]
      : []),
  ];
  return s.db.select().from(announcements).where(and(...filters))
    .orderBy(desc(announcements.date), desc(announcements.createdAt));
}
