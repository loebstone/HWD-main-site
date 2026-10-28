import assert from "node:assert/strict";
import { test } from "node:test";
import { nameOf } from "../src/lib/personal-name.ts";

test("personal address prefers goes-by, otherwise derives the first name", () => {
  const cases = [
    { displayName: "Example, Alexandra Marie", goesBy: " Alex ", expected: "Alex" },
    { displayName: "Example, Alexandra Marie", goesBy: null, expected: "Alexandra" },
    { displayName: "Example,   Alexandra   Marie ", goesBy: "  ", expected: "Alexandra" },
    { displayName: " Alexandra Marie Example ", expected: "Alexandra" },
    { displayName: "Alexandra\tMarie Example", expected: "Alexandra" },
    { displayName: "Alexandra", expected: "Alexandra" },
    { displayName: "Example, Alexandra", goesBy: "Alex Marie", expected: "Alex Marie" },
    { displayName: "Example,", expected: "" },
    { displayName: "", expected: "" },
  ];
  for (const { expected, ...identity } of cases) {
    assert.equal(nameOf(identity), expected, JSON.stringify(identity));
  }
});
