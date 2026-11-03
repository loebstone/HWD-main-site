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
type Reason = "ok" | "unreachable" | "401" | "other status" | "empty slots" | "setting missing" | "invalid setting" | "invalid response";
type Outcome = { year: number; reason: Reason; value: Rotation | null; status?: number };
type Cached = { expiresAt: number; value?: Outcome; pending?: Promise<Outcome> };
const caches = new WeakMap<Services, Map<string, Cached>>();
const outages = new WeakMap<Services, Set<string>>();
const SUCCESS_TTL = 3_600_000;
const FAILURE_TTL = 300_000;

async function fetchRotation(s: Services, year: number, email: string, personId: string): Promise<Outcome> {
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
    url.searchParams.set("email", email);
    url.searchParams.set("personId", personId);
  } catch { return failed("invalid setting"); }
  let response: Response;
  try {
    response = await (s.schedulerFetch ?? fetch)(url, { method: "GET",
      headers: { Authorization: `Bearer ${required("SITE_SERVICE_KEY")}` },
      redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch { return failed("unreachable"); }
  if (!response.ok) return failed(response.status === 401 ? "401" : "other status", response.status);
  try {
    const payload = rotation.parse(await response.json());
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
    "Scheduler rotation unavailable; family-time bar omitted");
}

async function rotationFor(s: Services, year: number, email: string, personId: string, fresh: boolean): Promise<Outcome> {
  const base = process.env.SCHEDULER_BASE_URL?.trim().replace(/\/$/, "") ?? "";
  const outageKey = createHash("sha256").update(JSON.stringify([base, year])).digest("hex");
  const fetchAndRecord = async () => {
    const value = await fetchRotation(s, year, email, personId);
    recordOutcome(s, outageKey, value);
    return value;
  };
  // The diagnostic never reads or overwrites Home's cached result.
  if (fresh) return fetchAndRecord();
  const key = createHash("sha256").update(JSON.stringify([base, year, personId, email])).digest("hex");
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
async function season(s: Services, email: string, personId: string, fresh: boolean) {
  const now = s.now(), today = now.toISOString().slice(0, 10);
  let result = await rotationFor(s, now.getUTCFullYear(), email, personId, fresh);
  const value = result.value;
  if (!value) return result;
  // End dates are exclusive: on that date the season is no longer current.
  if (today >= value.slots.reduce((latest, slot) => slot.endDate > latest ? slot.endDate : latest, "")) {
    result = await rotationFor(s, now.getUTCFullYear() + 1, email, personId, fresh);
  }
  return result;
}
export async function checkFamilyTime(s: Services, email: string, personId: string) {
  const result = await season(s, email, personId, true);
  return { ok: result.reason === "ok", reason: result.reason, year: result.year, slotCount: result.value?.slots.length ?? 0 };
}
export async function getFamilyTime(s: Services, email: string, personId: string, schedulerHref: string) {
  const { value } = await season(s, email, personId, false);
  if (!value) return null;
  return { year: value.year, slots: [...value.slots].sort((a, b) =>
    a.slotNumber - b.slotNumber || a.segmentIndex - b.segmentIndex || a.startDate.localeCompare(b.startDate)),
    yourFamily: value.yourFamily, schedulerHref };
}
