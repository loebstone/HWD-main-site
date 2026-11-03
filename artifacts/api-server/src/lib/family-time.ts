import { createHash } from "node:crypto";
import { z } from "zod";
import { required } from "./config";
import { logger } from "./logger";
import type { Services } from "./services";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const family = z.object({ familyGroupId: z.string().min(1).max(150), familyName: z.string().min(1).max(200) });
const rotation = z.object({
  year: z.number().int().min(1900).max(9999),
  slots: z.array(family.extend({
    slotNumber: z.number().int(), segmentIndex: z.number().int(),
    displayColor: z.string().max(80),
    startDate: date, endDate: date, isManualOverride: z.boolean(),
  }).refine(slot => slot.startDate < slot.endDate)).max(100),
  yourFamily: family.nullable(),
});
type Rotation = z.infer<typeof rotation>;
type Cached = { expiresAt: number; value: Rotation | null; pending?: Promise<Rotation | null> };
const caches = new WeakMap<Services, Map<string, Cached>>();

async function rotationFor(s: Services, year: number, email: string, personId: string): Promise<Rotation | null> {
  const base = required("SCHEDULER_BASE_URL").replace(/\/$/, "");
  const baseUrl = new URL(base);
  if (baseUrl.username || baseUrl.password || (baseUrl.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && baseUrl.protocol === "http:" && ["127.0.0.1", "localhost"].includes(baseUrl.hostname)))) {
    throw new Error("Invalid Scheduler origin");
  }
  const key = createHash("sha256").update(JSON.stringify([base, year, personId, email])).digest("hex");
  let cache = caches.get(s);
  if (!cache) { cache = new Map(); caches.set(s, cache); }
  const hit = cache.get(key);
  if (hit && hit.expiresAt > s.now().getTime()) return hit.pending ?? hit.value;
  const entry: Cached = { value: null, expiresAt: s.now().getTime() + 3_600_000 };
  // Bound per-process memory; expired or oldest entries can be refetched safely.
  if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
  cache.set(key, entry);
  entry.pending = (async () => {
    try {
      const url = new URL("/api/service/rotation", base);
      url.searchParams.set("year", String(year));
      url.searchParams.set("email", email);
      url.searchParams.set("personId", personId);
      const response = await (s.schedulerFetch ?? fetch)(url, { method: "GET",
        headers: { Authorization: `Bearer ${required("SITE_SERVICE_KEY")}` },
        redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Scheduler refused rotation");
      const payload = rotation.parse(await response.json());
      if (payload.year !== year) throw new Error("Unexpected rotation year");
      entry.value = payload;
      return payload;
    } catch {
      // Do not log URLs, headers, email, response bodies or credentials.
      logger.warn("Scheduler rotation unavailable; family-time bar omitted");
      entry.value = null;
      return null;
    } finally { entry.pending = undefined; }
  })();
  return entry.pending;
}
export async function getFamilyTime(s: Services, email: string, personId: string, schedulerHref: string) {
  try {
    const now = s.now();
    const today = now.toISOString().slice(0, 10);
    let value = await rotationFor(s, now.getUTCFullYear(), email, personId);
    if (!value?.slots.length) return null;
    // End dates are exclusive: on that date the season is no longer current.
    if (today >= value.slots.reduce((latest, slot) => slot.endDate > latest ? slot.endDate : latest, "")) {
      value = await rotationFor(s, now.getUTCFullYear() + 1, email, personId);
    }
    if (!value?.slots.length) return null;
    return { year: value.year, slots: [...value.slots].sort((a, b) =>
      a.slotNumber - b.slotNumber || a.segmentIndex - b.segmentIndex || a.startDate.localeCompare(b.startDate)),
      yourFamily: value.yourFamily, schedulerHref };
  } catch {
    // Unset configuration is also optional, and must not break Home.
    return null;
  }
}
