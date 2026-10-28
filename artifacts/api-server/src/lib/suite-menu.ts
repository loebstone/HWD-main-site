import { eq } from "drizzle-orm";
import { z } from "zod";
import { siteSettings, type SiteIdentity } from "@workspace/db";
import { appOrigin } from "./config";
import { rosterSignOut } from "./sso";
import type { Services } from "./services";

export const menuIds = ["home", "announcements", "scheduler", "directory", "documents", "contact"] as const;
export const toolIds = ["forecast", "captable"] as const;
export const SUITE_URL_MESSAGE = "Use an HTTPS URL on hwdfarm.com, a hwdfarm.com subdomain, or a Replit app/development host.";
const replitHost = (host: string) => host.endsWith(".replit.app") || host.endsWith(".replit.dev");
const farmHost = (host: string) => host === "hwdfarm.com" || host.endsWith(".hwdfarm.com");
export function isSuiteHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      (farmHost(url.hostname) || replitHost(url.hostname));
  } catch { return false; }
}
const label = z.string().trim().min(1).max(100);
const href = z.string().max(2048).refine(isSuiteHref, SUITE_URL_MESSAGE);
export const suiteMenuInput = z.object({
  items: z.array(z.object({ id: z.enum(menuIds), label, href, order: z.number().int().min(0).max(100) })).length(6),
  tools: z.array(z.object({ id: z.enum(toolIds), label, href })).length(2),
}).superRefine((value, ctx) => {
  if (new Set(value.items.map(i => i.id)).size !== 6 || new Set(value.tools.map(i => i.id)).size !== 2)
    ctx.addIssue({ code: "custom", message: "Every menu item and tool must appear exactly once." });
  if (new Set(value.items.map(i => i.order)).size !== 6)
    ctx.addIssue({ code: "custom", message: "Each menu item must have a different order." });
});
export const savedSuiteMenu = z.intersection(suiteMenuInput, z.object({ version: z.number().int().positive() }));
export const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 28" width="120" height="28" fill="#244b39" aria-label="HWD treeline" role="img"><path opacity=".8" d="M2 26 8 8 14 26Z"/><path opacity=".95" d="M14 26 22 2 30 26Z"/><path opacity=".75" d="M30 26 36 10 42 26Z"/><path d="M41 26 50 0 59 26Z"/><path opacity=".85" d="M58 26 65 7 72 26Z"/><path opacity=".95" d="M72 26 80 3 88 26Z"/><path opacity=".75" d="M87 26 94 9 101 26Z"/><path opacity=".9" d="M101 26 109 4 117 26Z"/></svg>';

export async function getSuiteMenu(s: Services) {
  const [row] = await s.db.select().from(siteSettings).where(eq(siteSettings.key, "suite-menu"));
  const origin = appOrigin();
  const value = row ? savedSuiteMenu.parse(row.value) : {
    version: 1,
    items: [
      { id: "home", label: "Home", href: `${origin}/`, order: 0 },
      { id: "announcements", label: "Announcements", href: `${origin}/announcements`, order: 1 },
      { id: "scheduler", label: "Scheduler", href: "https://calendar.hwdfarm.com", order: 2 },
      { id: "directory", label: "Family Directory", href: "https://roster.hwdfarm.com", order: 3 },
      { id: "documents", label: "Documents", href: `${origin}/documents`, order: 4 },
      { id: "contact", label: "Contact", href: `${origin}/contact`, order: 5 },
    ],
    tools: [
      { id: "forecast", label: "Forecast", href: "https://forecast.hwdfarm.com" },
      { id: "captable", label: "Cap Table", href: "https://captable.hwdfarm.com" },
    ],
  };
  return { version: value.version, logoSvg, items: [...value.items].sort((a, b) => a.order - b.order),
    tools: value.tools, signOutHref: rosterSignOut() };
}

export function toolAllowed(identity: Pick<SiteIdentity, "apps" | "role">, id: string): boolean {
  return identity.apps == null ? identity.role === "admin"
    : identity.apps.includes(id) || (id === "captable" && identity.apps.includes("cap-table"));
}

export function suiteCorsOrigin(origin: string, menu: Awaited<ReturnType<typeof getSuiteMenu>>): boolean {
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== "https:") return false;
    if (farmHost(url.hostname)) return true;
    if (!replitHost(url.hostname)) return false;
    // No wildcard for Replit tenants. Only origins registered by this app's
    // configuration or the administrator's public menu are considered suite apps.
    const origins = new Set([...menu.items, ...menu.tools].map(item => new URL(item.href).origin));
    origins.add(appOrigin());
    if (process.env.ROSTER_BASE_URL) origins.add(new URL(process.env.ROSTER_BASE_URL).origin);
    return origins.has(origin);
  } catch { return false; }
}
