import { test } from "node:test";
import assert from "node:assert/strict";
import { blankFormGroupDefault } from "../src/lib/document-form-default";

test("a blank render cannot overwrite the group being reset for an edited or moved document", () => {
  assert.equal(blankFormGroupDefault(true, "", "moved-group", undefined, "first-group"), undefined);
  assert.equal(blankFormGroupDefault(true, "", undefined, "filtered-group", "first-group"), undefined);
  assert.equal(blankFormGroupDefault(true, "user-picked-group", undefined, undefined, "first-group"), undefined);
});
test("only a genuinely blank new form receives the first asynchronously loaded group", () => {
  assert.equal(blankFormGroupDefault(true, "", undefined, undefined, undefined), undefined);
  assert.equal(blankFormGroupDefault(true, "", undefined, undefined, "first-group"), "first-group");
  assert.equal(blankFormGroupDefault(false, "", undefined, undefined, "first-group"), undefined);
});
