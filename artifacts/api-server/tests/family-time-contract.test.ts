import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { schedulerRotationSchema, checkFamilyTime, getFamilyTime } from "../src/lib/family-time";
import type { Services } from "../src/lib/services";

const fixture = async () => JSON.parse(await readFile(new URL("./fixtures/scheduler-rotation-live.json", import.meta.url), "utf8"));
function service(fetcher: typeof fetch, now = "2026-11-03T12:00:00Z"): Services {
  process.env.SCHEDULER_BASE_URL = "https://scheduler.example.invalid";
  process.env.SITE_SERVICE_KEY = "synthetic-contract-key";
  return { now: () => new Date(now), schedulerFetch: fetcher } as Services;
}

test("recorded live Scheduler 2026/2027 bodies validate without missing-field substitutions", async () => {
  const recorded = await fixture();
  for (const year of [2026, 2027]) {
    const value = schedulerRotationSchema.parse(recorded[year]);
    assert.equal(value.year, year);
    assert.equal(value.slots.length, 4);
    assert.deepEqual(value.slots.map(slot => slot.familyGroupId), recorded[year].slots.map((slot: { familyGroupId: number }) => String(slot.familyGroupId)));
    assert.equal(value.yourFamily, null);
    assert(!("generatedFrom" in value), "Allowed upstream extras do not leak into the Home response");
    const s = service(async input => new Response(JSON.stringify(recorded[Number(new URL(String(input)).searchParams.get("year"))])));
    assert.deepEqual(await checkFamilyTime(s, "nobody@example.invalid", "synthetic"),
      { ok: true, reason: "ok", year: 2027, slotCount: 4 });
  }
});

test("null colors, numeric yourFamily IDs, extra fields and valid ISO timestamps normalize safely", async () => {
  const body = (await fixture())[2027];
  body.extra = "ignored";
  body.yourFamily = { familyGroupId: 4, familyName: "Synthetic family" };
  const first = body.slots[0];
  first.displayColor = null;
  first.startDate = "2027-06-27T00:30:00+14:00";
  first.endDate = "2027-07-11T00:00:00.000Z";
  const value = schedulerRotationSchema.parse(body);
  assert.equal(value.slots[0].displayColor, "", "Existing safeColor chooses the site's green fallback");
  assert.equal(value.slots[0].startDate, "2027-06-27", "Calendar date, not UTC-shifted previous day");
  assert.equal(value.slots[0].endDate, "2027-07-11");
  assert.equal(value.yourFamily?.familyGroupId, "4");
  for (const timestamp of ["2027-06-27", "2027-06-27T00:00:00", "2027-06-27T00:00Z", "2027-06-27T23:59:59.123-04:00"]) {
    first.startDate = timestamp;
    assert.equal(schedulerRotationSchema.parse(body).slots[0].startDate, "2027-06-27");
  }
});

test("missing required fields, malformed dates and wrong response years remain refused", async () => {
  const recorded = await fixture();
  for (const field of ["slotNumber", "segmentIndex", "familyGroupId", "familyName", "displayColor", "startDate", "endDate", "isManualOverride"]) {
    const body = structuredClone(recorded[2027]);
    delete body.slots[0][field];
    assert(!schedulerRotationSchema.safeParse(body).success, `Required field ${field} must not be guessed`);
  }
  for (const field of ["year", "slots", "yourFamily"]) {
    const body = structuredClone(recorded[2027]);
    delete body[field];
    assert(!schedulerRotationSchema.safeParse(body).success);
  }
  for (const bad of ["2027-02-30", "2027-06-27 garbage", "06/27/2027", "2027-06-27T25:00:00Z", "2027-06-27T12:99:00Z"]) {
    const body = structuredClone(recorded[2027]);
    body.slots[0].startDate = bad;
    assert(!schedulerRotationSchema.safeParse(body).success, bad);
  }
  const s = service(async () => new Response(JSON.stringify(recorded[2027])), "2026-06-01Z");
  assert.deepEqual(await checkFamilyTime(s, "nobody@example.invalid", "synthetic"),
    { ok: false, reason: "invalid response", year: 2026, slotCount: 0 });
});

test("empty requested year tries the following year once; two empty years show nothing", async () => {
  const recorded = await fixture();
  const years: number[] = [];
  let bothEmpty = false;
  const s = service(async input => {
    const year = Number(new URL(String(input)).searchParams.get("year")); years.push(year);
    return new Response(JSON.stringify({ ...recorded[year], slots: year === 2026 || bothEmpty ? [] : recorded[year].slots }));
  }, "2026-06-01Z");
  assert.deepEqual(await checkFamilyTime(s, "nobody@example.invalid", "synthetic"),
    { ok: true, reason: "ok", year: 2027, slotCount: 4 });
  assert.deepEqual(years, [2026, 2027]);
  bothEmpty = true; years.length = 0;
  assert.deepEqual(await checkFamilyTime(s, "nobody@example.invalid", "synthetic"),
    { ok: false, reason: "empty slots", year: 2027, slotCount: 0 });
  assert.deepEqual(years, [2026, 2027], "Never request a third year");
  years.length = 0;
  assert.equal(await getFamilyTime(s, "nobody@example.invalid", "synthetic", "/scheduler"), null);
  assert.deepEqual(years, [2026, 2027]);
  await getFamilyTime(s, "nobody@example.invalid", "synthetic", "/scheduler");
  assert.deepEqual(years, [2026, 2027], "Both empty responses retain the five-minute cache");
});

test("authorization, transport and malformed responses do not trigger a next-year guess", async () => {
  for (const failure of ["401", "503", "network", "malformed"]) {
    let calls = 0;
    const s = service(async () => {
      calls++;
      if (failure === "network") throw new Error("synthetic network failure");
      return failure === "malformed" ? new Response("{}") : new Response("", { status: Number(failure) });
    });
    assert.equal((await checkFamilyTime(s, "nobody@example.invalid", "synthetic")).ok, false);
    assert.equal(calls, 1);
  }
});
