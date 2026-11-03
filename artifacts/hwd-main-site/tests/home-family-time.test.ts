import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatRange, familyRows, safeColor } from "../src/lib/family-time";
import { visibleSuiteTools } from "../src/lib/suite-menu";
import type { FamilyTime } from "@workspace/api-client-react";

test("family dates display exclusive ends inclusively without local time shifts", () => {
  assert.equal(formatRange({ startDate: "2027-05-01", endDate: "2027-05-08" }), "May 1 – May 7");
  assert.equal(formatRange({ startDate: "2027-05-01", endDate: "2027-05-02" }), "May 1");
});
test("families are in slot order and manual segments stay with the right family", () => {
  const ft: FamilyTime = { year: 2027, yourFamily: null, schedulerHref: "/scheduler", slots: [
    { slotNumber: 2, segmentIndex: 0, familyGroupId: "b", familyName: "B", displayColor: "#123456", startDate: "2027-06-01", endDate: "2027-07-01", isManualOverride: false },
    { slotNumber: 1, segmentIndex: 1, familyGroupId: "a", familyName: "A", displayColor: "#654321", startDate: "2027-05-10", endDate: "2027-05-20", isManualOverride: true },
    { slotNumber: 1, segmentIndex: 0, familyGroupId: "a", familyName: "A", displayColor: "#654321", startDate: "2027-05-01", endDate: "2027-05-10", isManualOverride: false },
  ] };
  assert.deepEqual(familyRows(ft).map(row => row.familyName), ["A", "B"]);
  assert.equal(familyRows(ft)[0].segments[0].startDate, "2027-05-01");
  assert.equal(safeColor("#123456"), "#123456");
  assert.equal(safeColor("url(https://evil.example)"), "hsl(var(--primary))");
});
test("member view has no Tools and clears role-scoped query cache on both transitions", () => {
  assert.deepEqual(visibleSuiteTools({ role: "member", apps: ["site", "scheduler", "roster"], viewAsMember: true },
    [{ id: "forecast", label: "Forecast", href: "https://forecast.hwdfarm.com" }]), []);
  const source = readFileSync(new URL("../src/lib/view-as-member.ts", import.meta.url), "utf8");
  assert.match(source, /await qc\.cancelQueries\(\)/);
  assert.match(source, /qc\.clear\(\)/);
  assert.match(source, /window\.location\.replace\(import\.meta\.env\.BASE_URL\)/);
});
test("Home order is hero, announcements, optional slideshow, cards; retired Home sections are absent", () => {
  const source = readFileSync(new URL("../src/pages/home.tsx", import.meta.url), "utf8");
  const hero = source.indexOf('data-testid="img-hero"');
  const announcements = source.indexOf('data-testid="section-announcements"');
  const slideshow = source.indexOf('data-testid="section-slideshow"');
  const cards = source.indexOf('data-testid="section-cards"');
  assert(hero >= 0 && hero < announcements && announcements < slideshow && slideshow < cards);
  assert(!source.includes("section-quick-access"));
  assert(!source.includes("Recently added"));
  assert.match(source, /loading="lazy"/);
  assert.match(source, /referrerPolicy="no-referrer"/);
  assert.match(source, /allow=""/);
  const settings = readFileSync(new URL("../src/pages/admin/admin-home.tsx", import.meta.url), "utf8");
  assert.match(settings, /placeholder="https:\/\/photos\.smugmug\.com\/frame\/\.\.\."/);
  assert(!settings.includes("docs.google.com"));
  assert.match(settings, /useCheckFamilyTime\(\{ query: \{ enabled: false, retry: false, gcTime: 0 \} \}\)/);
  assert.match(settings, /familyTime\.refetch\(\)/);
  assert.match(settings, /Check family time/);
  for (const field of ["ok", "reason", "year", "slotCount"]) assert(settings.includes(`familyTime.data.${field}`));
});
