import type { FamilySlot, FamilyTime } from "@workspace/api-client-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse YYYY-MM-DD (or ISO prefix) as a calendar date in UTC, avoiding local timezone shifts. */
export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDay(d: Date | null): string {
  return d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : "";
}

/** endDate is exclusive; return the inclusive last day. */
export function inclusiveEnd(end: string): Date | null {
  const d = parseDay(end);
  return d ? new Date(d.getTime() - 86_400_000) : null;
}

export function formatRange(slot: Pick<FamilySlot, "startDate" | "endDate">): string {
  const a = parseDay(slot.startDate);
  const b = inclusiveEnd(slot.endDate);
  if (!a || !b) return "";
  if (b.getTime() <= a.getTime()) return formatDay(a);
  return `${formatDay(a)} – ${formatDay(b)}`;
}

export type FamilyRow = { familyGroupId: string; familyName: string; displayColor: string; slotNumber: number; segments: FamilySlot[] };

/** Group slots by family in slot order; segments sorted by start date. */
export function familyRows(ft: FamilyTime): FamilyRow[] {
  const sorted = [...(ft.slots ?? [])].sort((x, y) => x.slotNumber - y.slotNumber || x.segmentIndex - y.segmentIndex);
  const map = new Map<string, FamilyRow>();
  for (const s of sorted) {
    let r = map.get(s.familyGroupId);
    if (!r) { r = { familyGroupId: s.familyGroupId, familyName: s.familyName, displayColor: s.displayColor, slotNumber: s.slotNumber, segments: [] }; map.set(s.familyGroupId, r); }
    r.segments.push(s);
  }
  const rows = [...map.values()];
  rows.forEach((r) => r.segments.sort((x, y) => x.startDate.localeCompare(y.startDate)));
  return rows;
}

export function safeColor(c: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(c) || /^(rgb|hsl)a?\([\d\s.,%]+\)$/.test(c) ? c : "hsl(var(--primary))";
}
