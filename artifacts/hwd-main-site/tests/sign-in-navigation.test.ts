import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareProtectedVisit } from "../src/lib/sign-in-navigation.ts";

const visit = { pathname: "/meetings/directors", search: "?year=2026", hash: "#top" };

test("anonymous protected visits redirect before rendering, retaining path/query/fragment", async () => {
  const steps: string[] = [];
  const result = await prepareProtectedVisit(visit,
    async () => { steps.push("session"); throw { status: 401 }; },
    async ({ to }) => {
      assert.equal(to, "/meetings/directors?year=2026#top");
      steps.push("entry");
      return { url: "https://authority.example.invalid/sign-in?app=site" };
    },
    url => { assert.equal(url, "https://authority.example.invalid/sign-in?app=site"); steps.push("replace"); });
  if (result === "render") steps.push("render");
  assert.deepEqual(steps, ["session", "entry", "replace"]);
  assert.equal(result, "redirect");
});

test("direct sign-in, admin back door and Continue remain public without automatic hand-off", async () => {
  for (const pathname of ["/sign-in", "/admin/sign-in", "/auth/continue"]) {
    const unexpected = async (): Promise<never> => { assert.fail("Public visits must not trigger auth"); };
    assert.equal(await prepareProtectedVisit({ ...visit, pathname }, unexpected, unexpected, unexpected), "render");
  }
});

test("signed-in visits render; network/configuration failures render retry UI, never loop redirects", async () => {
  const unexpected = async (): Promise<never> => { assert.fail("Unexpected redirect"); };
  assert.equal(await prepareProtectedVisit(visit, async () => ({}), unexpected, unexpected), "render");
  for (const status of [403, 503]) {
    assert.equal(await prepareProtectedVisit(visit, async () => { throw { status }; }, unexpected, unexpected), "render");
  }
  assert.equal(await prepareProtectedVisit(visit, async () => { throw { status: 401 }; },
    async () => { throw new Error("unavailable"); }, unexpected), "render");
});
