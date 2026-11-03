import { createHash } from "node:crypto";
import { z } from "zod";
import { required } from "./config";
import { logger } from "./logger";
import type { Services } from "./services";

// Slots represent calendar days, not instants. Keep the ISO date prefix even
// when an upstream timestamp has an offset; UTC conversion could shift the day.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/).refine(value => {
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day &&
    (value.length === 10 || !Number.isNaN(Date.parse(value)));
}).transform(value => value.slice(0, 10));
const familyId = z.union([z.string().min(1).max(150), z.number().int().safe()]).transform(String);
const family = z.object({ familyGroupId: familyId, familyName: z.string().min(1).max(200) });
export const schedulerRotationSchema = z.object({
  year: z.number().int().min(1900).max(9999),
  slots: z.array(family.extend({
    slotNumber: z.number().int(), segmentIndex: z.number().int(),
    displayColor: z.string().max(80).nullable().transform(value => value ?? ""),
    startDate: date, endDate: date, isManualOverride: z.boolean(),
  }).refine(slot => slot.startDate < slot.endDate)).max(100),
});
type Rotation = z.infer<typeof schedulerRotationSchema>;
type Reason = "ok" | "unreachable" | "401" | "other status" | "empty slots" | "setting missing" | "invalid setting" | "invalid response";
type Outcome = { year: number; reason: Reason; value: Rotation | null; status?: number };
type Cached = { expiresAt: number; value?: Outcome; pending?: Promise<Outcome> };
const caches = new WeakMap<Services, Map<string, Cached>>();
const outages = new WeakMap<Services, Set<string>>();
const SUCCESS_TTL = 3_600_000;
const FAILURE_TTL = 300_000;

async function fetchRotation(s: Services, year: number): Promise<Outcome> {
  const failed = (reason: Reason, status?: number): Outcome => ({ year, reason, value: null, status });
  if (!process.env.SCHEDULER_BASE_URL?.trim() || !process.env.SITE_SERVICE_KEY?.trim()) return failed("setting missing");
  let url: URL;
  try {
    const base = new URL(required("SCHEDULER_BASE_URL"));
    if (base.username || base.password || (base.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname)))) {
      return failed("invalid setting");
    }
    url = new URL("/api/service/rotation", base);
    url.searchParams.set("year", String(year));
  } catch { return failed("invalid setting"); }
  let response: Response;
  try {
    response = await (s.schedulerFetch ?? fetch)(url, { method: "GET",
      headers: { Authorization: `Bearer ${required("SITE_SERVICE_KEY")}` },
      redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch { return failed("unreachable"); }
  if (!response.ok) return failed(response.status === 401 ? "401" : "other status", response.status);
  try {
    const payload = schedulerRotationSchema.parse(await response.json());
    if (payload.year !== year) return failed("invalid response");
    if (!payload.slots.length) return failed("empty slots");
    return { year, reason: "ok", value: payload };
  } catch { return failed("invalid response"); }
}

function recordOutcome(s: Services, outageKey: string, outcome: Outcome) {
  let active = outages.get(s);
  if (!active) { active = new Set(); outages.set(s, active); }
  if (outcome.reason === "ok") { active.delete(outageKey); return; }
  if (active.has(outageKey)) return;
  if (active.size >= 1000) active.delete(active.values().next().value!);
  active.add(outageKey);
  // One line per origin/year outage, shared across members and retries. Never log
  // URLs, email, person ID, bodies, credentials or raw error messages.
  logger.warn({ reason: outcome.reason, year: outcome.year, ...(outcome.status ? { status: outcome.status } : {}) },
    "Scheduler rotation unavailable for requested year");
}

async function rotationFor(s: Services, year: number, fresh: boolean): Promise<Outcome> {
  const base = process.env.SCHEDULER_BASE_URL?.trim().replace(/\/$/, "") ?? "";
  const outageKey = createHash("sha256").update(JSON.stringify([base, year])).digest("hex");
  const fetchAndRecord = async () => {
    const value = await fetchRotation(s, year);
    recordOutcome(s, outageKey, value);
    return value;
  };
  // The diagnostic never reads or overwrites Home's cached result.
  if (fresh) return fetchAndRecord();
  const key = outageKey;
  let cache = caches.get(s);
  if (!cache) { cache = new Map(); caches.set(s, cache); }
  const hit = cache.get(key);
  if (hit?.pending) return hit.pending;
  if (hit?.value && hit.expiresAt > s.now().getTime()) return hit.value;
  const entry: Cached = { expiresAt: 0 };
  // Bound per-process memory; expired or oldest entries can be refetched safely.
  if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
  cache.set(key, entry);
  entry.pending = (async () => {
    const outcome = await fetchAndRecord();
    entry.value = outcome;
    entry.expiresAt = s.now().getTime() + (outcome.reason === "ok" ? SUCCESS_TTL : FAILURE_TTL);
    entry.pending = undefined;
    return outcome;
  })();
  return entry.pending;
}
async function season(s: Services, fresh: boolean) {
  const now = s.now(), today = now.toISOString().slice(0, 10);
  let result = await rotationFor(s, now.getUTCFullYear(), fresh);
  const value = result.value;
  // An empty current season gets exactly one next-year attempt; transport,
  // authorization and validation failures never become guessed future seasons.
  if (!value) return result.reason === "empty slots" ?
    rotationFor(s, now.getUTCFullYear() + 1, fresh) : result;
  // End dates are exclusive: on that date the season is no longer current.
  if (today >= value.slots.reduce((latest, slot) => slot.endDate > latest ? slot.endDate : latest, "")) {
    result = await rotationFor(s, now.getUTCFullYear() + 1, fresh);
  }
  return result;
}
export async function checkFamilyTime(s: Services) {
  const result = await season(s, true);
  return { ok: result.reason === "ok", reason: result.reason, year: result.year, slotCount: result.value?.slots.length ?? 0 };
}
export async function getFamilyTime(s: Services, schedulerHref: string) {
  const { value } = await season(s, false);
  if (!value) return null;
  return { year: value.year, slots: [...value.slots].sort((a, b) =>
    a.slotNumber - b.slotNumber || a.segmentIndex - b.segmentIndex || a.startDate.localeCompare(b.startDate)),
    schedulerHref };
}
