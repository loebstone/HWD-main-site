import type { Identity, SuiteItem, SuiteTool } from "@workspace/api-client-react";

export const DEFAULT_ITEMS: SuiteItem[] = [
  { id: "home", label: "Home", href: "/", order: 0 },
  { id: "announcements", label: "Announcements", href: "/announcements", order: 1 },
  { id: "scheduler", label: "Scheduler", href: "", order: 2 },
  { id: "directory", label: "Family Directory", href: "", order: 3 },
  { id: "documents", label: "Documents", href: "/documents", order: 4 },
  { id: "contact", label: "Contact", href: "/contact", order: 5 },
];
export const DEFAULT_TOOLS: SuiteTool[] = [
  { id: "forecast", label: "Forecast", href: "" },
  { id: "captable", label: "Cap Table", href: "" },
];

const normalizeApp = (id: string) => (id === "cap-table" ? "captable" : id);

/** Tools visible to an identity. Absent/null apps falls back to admin-only; explicit [] means none. */
export function visibleSuiteTools(identity: Pick<Identity, "role" | "apps"> | undefined | null, tools: SuiteTool[]): SuiteTool[] {
  if (!identity) return [];
  const apps = identity.apps;
  if (apps === undefined || apps === null) return identity.role === "admin" ? tools.filter((t) => !!t.href) : [];
  const allowed = new Set(apps.map(normalizeApp));
  return tools.filter((t) => !!t.href && allowed.has(normalizeApp(t.id)));
}

export function sortItems(items: SuiteItem[]): SuiteItem[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/** Returns local path if href points at this site, otherwise null. */
export function localPath(href: string, origin: string = typeof window !== "undefined" ? window.location.origin : ""): string | null {
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const u = new URL(href);
    if (origin && u.origin === origin) {
      const base = (import.meta.env?.BASE_URL || "/").replace(/\/$/, "");
      let p = u.pathname;
      if (base && p.startsWith(base)) p = p.slice(base.length) || "/";
      return p + u.search + u.hash;
    }
  } catch { /* not a URL */ }
  return null;
}
