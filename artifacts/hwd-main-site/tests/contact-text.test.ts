import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeader } from "../src/components/page-header";

test("Contact renders the default introductory text and an edited value as plain text", () => {
  const defaultText = "Questions, requests, corrections — send them here and the right person will get back to you.";
  const render = (intro: string) => renderToStaticMarkup(createElement(PageHeader, { title: "Contact", intro }));
  assert(render(defaultText).includes(defaultText));
  const edited = render("Please send questions here. <b>Plain text only.</b>");
  assert(edited.includes("Please send questions here. &lt;b&gt;Plain text only.&lt;/b&gt;"));
  assert(!edited.includes(defaultText));
  const page = readFileSync(new URL("../src/pages/contact.tsx", import.meta.url), "utf8");
  assert.match(page, /intro=\{status\.data\?\.textAboveForm\}/);
  assert(!page.includes("Send a note to the people who look after the Farm."));
  const admin = readFileSync(new URL("../src/pages/admin/admin-suite.tsx", import.meta.url), "utf8");
  assert.match(admin, /Text above the form/);
  assert.match(admin, /maxLength=\{300\} value=\{textAboveForm\}/);
  assert.match(admin, /recipient: value\.trim\(\), textAboveForm/);
  assert.match(admin, /invalidateQueries\(\{ queryKey: getGetContactStatusQueryKey\(\)/);
});
