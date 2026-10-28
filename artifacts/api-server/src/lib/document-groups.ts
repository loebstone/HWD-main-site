import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { documentGroups, documents, siteSettings, type db, type SiteIdentity } from "@workspace/db";
import { z } from "zod";
import { DEFAULT_GROUPS } from "../migrate-document-groups";
import type { Services } from "./services";

export class GroupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const activeGroups = (role: SiteIdentity["role"]) => and(
  isNull(documentGroups.retiredAt), role === "member" ? eq(documentGroups.visibility, "everyone") : undefined,
);
export function visibleDocumentFilter(s: Services, role: SiteIdentity["role"], includeRetiredGroups = false) {
  return inArray(documents.groupId, s.db.select({ id: documentGroups.id }).from(documentGroups)
    .where(includeRetiredGroups && role !== "member" ? undefined : activeGroups(role)));
}
export async function listGroups(s: Services, role: SiteIdentity["role"]) {
  const groups = await s.db.select().from(documentGroups).where(activeGroups(role))
    .orderBy(asc(documentGroups.sortOrder), asc(documentGroups.name));
  if (!groups.length) return [];
  const live = await s.db.select({ groupId: documents.groupId, title: documents.title, uploadedAt: documents.uploadedAt })
    .from(documents).where(and(isNull(documents.retiredAt), inArray(documents.groupId, groups.map(g => g.id))))
    .orderBy(desc(documents.uploadedAt), asc(documents.title));
  return groups.map(g => {
    const items = live.filter(d => d.groupId === g.id);
    return { ...g, documentCount: items.length, latestTitle: items[0]?.title ?? null, latestDate: items[0]?.uploadedAt ?? null };
  });
}

type GroupWriter = Pick<typeof db, "select" | "update">;
// Mutations lock the target group before touching documents, serializing against retirement.
export async function lockLiveGroup(writer: GroupWriter, id: string) {
  const [group] = await writer.select().from(documentGroups).where(and(eq(documentGroups.id, id), isNull(documentGroups.retiredAt))).for("update");
  if (!group) throw new GroupError("Choose an active document group");
  return group;
}

export function slugFromName(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export const groupInput = z.object({
  name: z.string().trim().min(1).max(150),
  slug: z.string().trim().max(180).optional(),
  description: z.string().trim().max(500).default(""),
  sortOrder: z.number().int(),
  layout: z.enum(["list", "by_year"]),
  visibility: z.enum(["everyone", "staff"]),
}).transform(data => ({ ...data, slug: data.slug || slugFromName(data.name) }))
  .refine(data => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug), "Use a slug with lowercase letters, numbers and hyphens");

export const homeGroupsInput = z.object({ groupIds: z.array(z.string().uuid()).max(4).refine(ids => new Set(ids).size === ids.length, "Choose each group once") });
export async function getFeaturedGroupIds(s: Services) {
  const [setting] = await s.db.select().from(siteSettings).where(eq(siteSettings.key, "home-groups"));
  return setting ? homeGroupsInput.parse(setting.value).groupIds : DEFAULT_GROUPS.slice(0, 4).map(g => g.id);
}

export async function legacyGroupLocation(s: Services, route: string) {
  if (route === "/meetings") return "/documents";
  const section = ({ "/meetings/shareholders": "shareholders", "/meetings/directors": "directors",
    "/logging": "logging", "/governing": "governing", "/photo-archive": "photo_archive" } as Record<string, string>)[route];
  const seed = DEFAULT_GROUPS.find(g => g.section === section);
  if (!seed) return null;
  const [group] = await s.db.select().from(documentGroups).where(eq(documentGroups.id, seed.id));
  // Do not leak staff group metadata to anonymous legacy URL requests.
  return group?.visibility === "everyone" && !group.retiredAt ? `/documents/${group.slug}` : "/documents";
}
