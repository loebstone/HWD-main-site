import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ITEMS, sortItems, visibleSuiteTools, localPath } from "../src/lib/suite-menu";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Logo } from "../src/components/logo";
import { readFile } from "node:fs/promises";

const tools = [
  { id: "forecast", label: "Forecast", href: "https://forecast.hwdfarm.com" },
  { id: "captable", label: "Cap Table", href: "https://captable.hwdfarm.com" },
];
test("member menu order exactly matches the suite design; sorting never mutates input", () => {
  assert.deepEqual(DEFAULT_ITEMS.map(i => i.label),
    ["Home", "Announcements", "Scheduler", "Family Directory", "Documents", "Contact"]);
  const reversed = [...DEFAULT_ITEMS].reverse();
  assert.deepEqual(sortItems(reversed), DEFAULT_ITEMS);
  assert.equal(reversed[0]!.id, "contact");
});
test("Tools follows explicit apps, with admin-only fallback solely for legacy missing/null apps", () => {
  assert.deepEqual(visibleSuiteTools({ role: "member", apps: ["forecast"] }, tools), [tools[0]]);
  assert.deepEqual(visibleSuiteTools({ role: "editor", apps: ["captable"] }, tools), [tools[1]]);
  assert.deepEqual(visibleSuiteTools({ role: "member", apps: ["cap-table"] }, tools), [tools[1]]);
  assert.deepEqual(visibleSuiteTools({ role: "admin", apps: [] }, tools), []);
  assert.deepEqual(visibleSuiteTools({ role: "member", apps: ["site"] }, tools), []);
  assert.deepEqual(visibleSuiteTools({ role: "admin" }, tools), tools);
  assert.deepEqual(visibleSuiteTools({ role: "admin", apps: null }, tools), tools);
  assert.deepEqual(visibleSuiteTools({ role: "editor" }, tools), []);
  assert.deepEqual(visibleSuiteTools(undefined, tools), []);
});
test("same-origin menu URLs become local routes; other apps stay same-tab anchors", () => {
  assert.equal(localPath("https://hwdfarm.com/documents", "https://hwdfarm.com"), "/documents");
  assert.equal(localPath("https://roster.hwdfarm.com", "https://hwdfarm.com"), null);
  assert.equal(localPath("//evil.example", "https://hwdfarm.com"), null);
  assert.equal(localPath("/contact", "https://hwdfarm.com"), "/contact");
});
test("logo renders an inline eight-tree mark and HWD Farm wordmark, including large sign-in size", () => {
  const html = renderToStaticMarkup(createElement(Logo));
  assert.match(html, /viewBox="0 0 120 28"/);
  assert.equal((html.match(/<polygon /g) ?? []).length, 8);
  assert.match(html, /HWD Farm/);
  assert.match(renderToStaticMarkup(createElement(Logo, { large: true })), /h-10/);
});
test("Home reads its notice from the member-safe Home response, never editor-only settings", async () => {
  const source = await readFile(new URL("../src/pages/home.tsx", import.meta.url), "utf8");
  assert.match(source, /const d = home\.data/);
  assert.match(source, /const notice = d\?\.notice\?\.text/);
  assert(!source.includes("useGetHomeNotice"));
});
