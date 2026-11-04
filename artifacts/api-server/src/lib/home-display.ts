import { eq } from "drizzle-orm";
import { siteSettings } from "@workspace/db";
import { z } from "zod";
import type { Services } from "./services";

export const SLIDESHOW_URL_MESSAGE = "Use an HTTPS slideshow URL on smugmug.com or a subdomain of smugmug.com.";
export const homeDisplayInput = z.object({
  slideshowEmbedUrl: z.string().trim().max(2048).nullable().transform(value => value || null)
    .refine(value => {
      if (value === null) return true;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443")
          && (url.hostname === "smugmug.com" || url.hostname.endsWith(".smugmug.com"));
      } catch { return false; }
    }, SLIDESHOW_URL_MESSAGE),
  featuredLineMode: z.enum(["automatic", "chosen", "none"]).default("automatic"),
  featuredDocumentId: z.string().uuid().nullable().default(null),
  featuredLabel: z.string().trim().max(100).default("Featured:"),
}).strict().superRefine((value, ctx) => {
  if (value.featuredLineMode === "chosen" && !value.featuredDocumentId) {
    ctx.addIssue({ code: "custom", path: ["featuredDocumentId"], message: "Choose a live document for the featured line." });
  }
});
export const duesInput = z.object({ seasonOpen: z.boolean(), text: z.string().max(10_000) }).strict();
export async function getHomeDisplay(s: Services) {
  const [row] = await s.db.select().from(siteSettings).where(eq(siteSettings.key, "home-display"));
  return homeDisplayInput.parse(row ? row.value : { slideshowEmbedUrl: null });
}
export async function getDuesSettings(s: Services) {
  const [row] = await s.db.select().from(siteSettings).where(eq(siteSettings.key, "dues"));
  return row ? duesInput.parse(row.value) : { seasonOpen: false, text: "" };
}
