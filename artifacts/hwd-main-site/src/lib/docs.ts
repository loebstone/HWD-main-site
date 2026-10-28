import type { Document } from "@workspace/api-client-react";

export function openUrl(id: string) {
  return `/api/documents/${encodeURIComponent(id)}/open`;
}

export function sortDocs(docs: Document[]) {
  return [...docs].sort((a, b) => {
    const ya = a.year ?? -Infinity, yb = b.year ?? -Infinity;
    if (ya !== yb) return yb - ya;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.title.localeCompare(b.title);
  });
}

export function groupByYear(docs: Document[]) {
  const groups: { year: number | null; docs: Document[] }[] = [];
  for (const d of sortDocs(docs)) {
    const last = groups[groups.length - 1];
    if (last && last.year === d.year) last.docs.push(d);
    else groups.push({ year: d.year, docs: [d] });
  }
  return groups;
}

export function matches(d: Document, q: string) {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [d.title, d.note, String(d.year ?? ""), ...d.tags].join(" ").toLowerCase().includes(t);
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function sortList(docs: Document[]) {
  return [...docs].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}
