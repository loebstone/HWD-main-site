import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { mkdir } from "node:fs/promises";
import pg from "pg";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { pool, loginTokens, sessions, grants, documents, auditLog } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { createApp } from "../src/app";
import { checkRoster } from "../src/lib/roster";
import { sendSignInLink } from "../src/lib/email";
import { hashToken, newToken } from "../src/lib/auth";
import { appOrigin, DAY, neutralMessage } from "../src/lib/config";
import { logger } from "../src/lib/logger";
import type { Services } from "../src/lib/services";

// Tests use one dedicated schema on the development DB, synthetic *.invalid identities,
// stubbed Roster HTTP and in-memory file storage. No queries to public person/application rows.
test("HWD foundation: isolated development security suite", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production", "Never run tests against production");
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "synthetic-test-secret-not-a-real-credential";
  process.env.SITE_SERVICE_KEY = "synthetic-roster-service-key";
  process.env.MAIL_FROM = "HWD Test <nobody@example.invalid>";
  process.env.APP_ORIGIN = "https://hwd-test.example.invalid";
  process.env.BOOTSTRAP_PERSON_ID = "synthetic-admin";
  logger.level = "silent";
  const host = new URL(process.env.DATABASE_URL!).hostname;
  console.info(`Environment: development; configured database host confirmed before query: ${host}`);
  const connection = await pool.connect();
  const isolated = `hwd_test_${randomUUID().replace(/-/g, "")}`;
  await connection.query(`CREATE SCHEMA "${isolated}"`);
  await connection.query(`SET search_path TO "${isolated}"`);
  const evidence = await connection.query("SELECT inet_server_addr()::text AS server_address, current_database() AS database_name");
  console.info("Observed database by query:", evidence.rows[0], "isolated schema:", isolated);
  for (const table of ["site_login_tokens", "site_sessions", "site_grants", "site_documents", "site_audit_log", "site_rate_limits"]) {
    await connection.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
  }
  await connection.query(await readFile(new URL("../../../lib/db/security.sql", import.meta.url), "utf8"));
  const isolatedPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, options: `-c search_path=${isolated}` });
  const testDb = drizzle(isolatedPool, { schema });
  let time = new Date("2026-10-28T12:00:00Z");
  const captured: string[] = [];
  const files = new Map<string, Buffer>();
  let mode: "allow" | "deny" | "bad" | "redirect" = "allow";
  let rosterCalls = 0;
  const roster = createServer(async (req, res) => {
    rosterCalls++;
    assert.equal(req.url, "/api/service/sign-in-check");
    assert.equal(req.method, "POST");
    assert.equal(req.headers.authorization, "Bearer synthetic-roster-service-key");
    let raw = ""; for await (const part of req) raw += part;
    const { email } = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    if (mode === "redirect") { res.writeHead(302, { Location: "/elsewhere" }); res.end(); return; }
    if (mode === "bad") { res.end('{"allowed":true}'); return; }
    if (mode === "deny") { res.end('{"allowed":false}'); return; }
    const personId = email === "admin@example.invalid" ? "synthetic-admin" : `synthetic-${email.split("@")[0]}`;
    res.end(JSON.stringify({ allowed: true, personId, displayName: "Synthetic Test Person", goes_by: "Test" }));
  });
  await new Promise<void>(resolve => roster.listen(0, "127.0.0.1", resolve));
  const address = roster.address(); assert(address && typeof address !== "string");
  process.env.ROSTER_BASE_URL = `http://127.0.0.1:${address.port}`;
  const services: Services = {
    db: testDb, roster: checkRoster, now: () => new Date(time),
    email: async (email, link) => { await sendSignInLink(email, link); captured.push(link); },
    storage: {
      async save(bytes) { const id = randomUUID(); files.set(id, bytes); return id; },
      async read(key) { assert(files.has(key)); return Readable.from(files.get(key)!); },
    },
  };
  const app = createApp(services);
  let addressCounter = 1;
  const ip = () => `198.51.100.${addressCounter++}`;
  const base = { title: "Synthetic document", section: "shareholders", year: 2026,
    type: "pdf", sortOrder: 0, tags: ["test"], note: "Synthetic private note" };
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj <</Type /Catalog>> endobj\n%%EOF\n");
  const link = async (email: string) => {
    const res = await request(app).post("/api/auth/link").set("X-Forwarded-For", ip()).send({ email });
    assert.equal(res.status, 200); assert.equal(res.body.message, neutralMessage);
    return new URL(captured.at(-1)!).searchParams.get("token")!;
  };
  const login = async (email: string) => {
    const token = await link(email);
    const res = await request(app).post("/api/auth/verify").set("X-Forwarded-For", ip()).send({ token });
    assert.equal(res.status, 200);
    return { res, cookie: res.headers["set-cookie"][0].split(";")[0] as string, token };
  };
  let adminCookie = "", memberCookie = "", editorCookie = "", documentId = "", replacementId = "";
  try {
    await t.test("health is anonymous, enforcing headers; every private API refuses anonymous access", async () => {
      const health = await request(app).get("/api/healthz");
      assert.equal(health.status, 200); assert.match(health.headers["content-security-policy"], /default-src 'none'/);
      for (const path of ["/api/auth/session", "/api/home", "/api/documents", `/api/documents/${randomUUID()}/open`, "/api/admin/grants", "/api/storage/objects/arbitrary"]) {
        const res = await request(app).get(path); assert.equal(res.status, 401, path);
        assert.equal(res.headers["cache-control"], "no-store");
      }
    });
    await t.test("missing bootstrap setting permits member sign-in but creates no grant", async () => {
      delete process.env.BOOTSTRAP_PERSON_ID;
      const signed = await login("no-bootstrap@example.invalid");
      assert.equal(signed.res.body.role, "member");
      assert.equal((await testDb.select().from(grants)).length, 0);
      process.env.BOOTSTRAP_PERSON_ID = "synthetic-admin";
    });
    await t.test("allowed email normalised; console delivery; only hash stored; bootstrap and session cookie", async () => {
      const token = await link("  ADMIN@EXAMPLE.INVALID  ");
      const [row] = await testDb.select().from(loginTokens).where(eq(loginTokens.hash, hashToken(token)));
      assert.equal(row!.email, "admin@example.invalid");
      assert.notEqual(row!.hash, token);
      assert.equal(row!.expiresAt.getTime() - time.getTime(), 15 * 60_000);
      const res = await request(app).post("/api/auth/verify").set("X-Forwarded-For", ip()).send({ token });
      assert.equal(res.status, 200); assert.equal(res.body.role, "admin");
      const cookie = res.headers["set-cookie"][0];
      assert.match(cookie, /site_session=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
      assert.doesNotMatch(cookie, /Secure/);
      adminCookie = cookie.split(";")[0];
      const [session] = await testDb.select().from(sessions).where(eq(sessions.hash, hashToken(adminCookie.split("=")[1]!)));
      assert.equal(session!.expiresAt.getTime() - time.getTime(), 30 * DAY);
    });
    await t.test("denied, unreachable, unexpected and redirected Roster answers are neutral and issue no token", async () => {
      for (const nextMode of ["deny", "bad", "redirect"] as const) {
        mode = nextMode; const before = captured.length;
        await request(app).post("/api/auth/link").set("X-Forwarded-For", ip())
          .send({ email: `${nextMode}@example.invalid` }).expect(200, { message: neutralMessage });
        assert.equal(captured.length, before);
      }
      mode = "allow";
      const original = process.env.ROSTER_BASE_URL; process.env.ROSTER_BASE_URL = "http://127.0.0.1:1";
      const before = captured.length;
      await request(app).post("/api/auth/link").set("X-Forwarded-For", ip()).send({ email: "unreachable@example.invalid" }).expect(200, { message: neutralMessage });
      assert.equal(captured.length, before); process.env.ROSTER_BASE_URL = original;
    });
    await t.test("missing settings refuse only dependent features and preserve neutral response", async () => {
      for (const key of ["ROSTER_BASE_URL", "SITE_SERVICE_KEY", "MAIL_FROM"]) {
        const saved = process.env[key]; delete process.env[key]; const before = captured.length;
        await request(app).post("/api/auth/link").set("X-Forwarded-For", ip())
          .send({ email: `${key.toLowerCase()}@example.invalid` }).expect(200, { message: neutralMessage });
        assert.equal(captured.length, before); process.env[key] = saved;
      }
      await request(app).get("/api/healthz").expect(200);
      const old = process.env.APP_ORIGIN; delete process.env.APP_ORIGIN;
      assert.equal(appOrigin(), `https://${process.env.REPLIT_DEV_DOMAIN}`);
      process.env.NODE_ENV = "production"; assert.throws(appOrigin, /APP_ORIGIN/);
      process.env.NODE_ENV = "test"; process.env.APP_ORIGIN = old;
    });
    await t.test("two simultaneous verifies: exactly one success; reuse refused", async () => {
      const token = await link("race@example.invalid");
      const [unused] = await testDb.select().from(loginTokens).where(eq(loginTokens.hash, hashToken(token)));
      await request(app).get("/api/auth/verify").set("X-Forwarded-For", ip()).expect(200);
      assert.equal(unused!.usedAt, null);
      const result = await Promise.all([1, 2].map(() => request(app).post("/api/auth/verify").set("X-Forwarded-For", ip()).send({ token })));
      assert.deepEqual(result.map(r => r.status).sort(), [200, 401]);
      await request(app).post("/api/auth/verify").set("X-Forwarded-For", ip()).send({ token }).expect(401);
    });
    await t.test("expired tokens and removal between request and verify are refused", async () => {
      const token = await link("expires@example.invalid"); time = new Date(time.getTime() + 16 * 60_000);
      await request(app).post("/api/auth/verify").set("X-Forwarded-For", ip()).send({ token }).expect(401);
      const removed = await link("removed@example.invalid"); mode = "deny";
      await request(app).post("/api/auth/verify").set("X-Forwarded-For", ip()).send({ token: removed }).expect(401);
      mode = "allow";
    });
    await t.test("member/editor permissions enforced server-side and grants are historical", async () => {
      memberCookie = (await login("member@example.invalid")).cookie;
      editorCookie = (await login("editor@example.invalid")).cookie;
      await request(app).post("/api/documents").set("Cookie", memberCookie).send({ ...base, type: "link", externalUrl: "https://example.invalid" }).expect(403);
      await request(app).get("/api/documents?includeRetired=true").set("Cookie", memberCookie).expect(403);
      await request(app).get("/api/admin/grants").set("Cookie", memberCookie).expect(403);
      const grant = await request(app).post("/api/admin/grants").set("Cookie", adminCookie)
        .send({ personId: "synthetic-editor", displayName: "Synthetic Editor", role: "editor" }).expect(201);
      await request(app).get("/api/auth/session").set("Cookie", editorCookie).expect(200).expect(res => assert.equal(res.body.role, "editor"));
      await request(app).get("/api/admin/grants").set("Cookie", editorCookie).expect(403);
      assert.equal(grant.body.endedAt, null);
    });
    await t.test("PDF signature, section/year and URL validation; missing files refused", async () => {
      await request(app).post("/api/documents/upload").set("Cookie", editorCookie)
        .field("metadata", JSON.stringify(base)).attach("file", Buffer.from("not pdf"), "fake.pdf").expect(400);
      await request(app).post("/api/documents/upload").set("Cookie", editorCookie)
        .field("metadata", JSON.stringify({ ...base, year: null })).attach("file", pdf, "test.pdf").expect(400);
      await request(app).post("/api/documents").set("Cookie", editorCookie)
        .send({ ...base, type: "link", externalUrl: "javascript:alert(1)" }).expect(400);
      await request(app).post("/api/documents/upload").set("Cookie", editorCookie)
        .field("metadata", JSON.stringify(base)).expect(400);
      await request(app).post("/api/documents/upload").set("Cookie", editorCookie)
        .field("metadata", JSON.stringify(base)).attach("file", Buffer.alloc(50 * 1024 * 1024 + 1), "large.pdf").expect(413);
    });
    await t.test("upload PDF; unauthenticated download refused; authenticated inline no-store stream and audit", async () => {
      const res = await request(app).post("/api/documents/upload").set("Cookie", editorCookie)
        .field("metadata", JSON.stringify(base)).attach("file", pdf, "test.pdf").expect(201);
      documentId = res.body.id; assert(!("storageKey" in res.body));
      await request(app).get(`/api/documents/${documentId}/open`).expect(401);
      const opened = await request(app).get(`/api/documents/${documentId}/open`).set("Cookie", memberCookie).expect(200);
      assert.equal(opened.headers["cache-control"], "no-store");
      assert.match(opened.headers["content-disposition"], /^inline;/);
      assert.equal(opened.headers["content-type"], "application/pdf");
      assert.deepEqual(opened.body, pdf);
      const events = await testDb.select().from(auditLog).where(and(eq(auditLog.targetId, documentId), eq(auditLog.action, "document-open")));
      assert.equal(events.length, 1);
    });
    await t.test("edit metadata, replacement retains old record/file and hides it; retire never deletes", async () => {
      await request(app).patch(`/api/documents/${documentId}`).set("Cookie", editorCookie).send({ ...base, title: "Updated synthetic title" }).expect(200);
      const replaced = await request(app).post(`/api/documents/${documentId}/replace`).set("Cookie", editorCookie)
        .field("metadata", JSON.stringify(base)).attach("file", pdf, "new.pdf").expect(201);
      replacementId = replaced.body.id; assert.equal(replaced.body.replaces, documentId);
      const listed = await request(app).get("/api/documents").set("Cookie", memberCookie).expect(200);
      assert(!listed.body.some((d: { id: string }) => d.id === documentId));
      await request(app).get(`/api/documents/${documentId}/open`).set("Cookie", memberCookie).expect(404);
      assert.equal(files.size, 2);
      await request(app).post(`/api/documents/${replacementId}/retire`).set("Cookie", editorCookie).expect(200);
      const [row] = await testDb.select().from(documents).where(eq(documents.id, replacementId)); assert(row!.retiredAt);
    });
    await t.test("external link open is audited and redirects without a signed storage URL", async () => {
      const added = await request(app).post("/api/documents").set("Cookie", editorCookie)
        .send({ ...base, type: "link", externalUrl: "https://example.invalid/album" }).expect(201);
      await request(app).get(`/api/documents/${added.body.id}/open`).set("Cookie", memberCookie).expect(302).expect("Location", "https://example.invalid/album");
    });
    await t.test("append-only database triggers refuse update, delete and truncate; docs/grants cannot be deleted", async () => {
      for (const statement of [
        "UPDATE site_audit_log SET description='tamper'",
        "DELETE FROM site_audit_log",
        "TRUNCATE site_audit_log",
        "DELETE FROM site_documents",
        "DELETE FROM site_grants",
      ]) await assert.rejects(connection.query(statement), /append-only|hard deletion/);
    });
    await t.test("expired sessions and absolute 12-month age are refused", async () => {
      for (const variant of ["expired", "old"]) {
        const token = newToken();
        await testDb.insert(sessions).values({ hash: hashToken(token), personId: `synthetic-${variant}`,
          displayName: "Synthetic Expiry", email: `${variant}@example.invalid`,
          createdAt: new Date(time.getTime() - (variant === "old" ? 367 : 1) * DAY),
          expiresAt: new Date(time.getTime() + (variant === "old" ? 1 : -1) * DAY) });
        await request(app).get("/api/home").set("Cookie", `site_session=${token}`).expect(401);
      }
    });
    await t.test("daily Roster recheck and sliding renewal; removed person session ends", async () => {
      time = new Date(time.getTime() + 2 * DAY);
      let before = rosterCalls;
      await request(app).get("/api/auth/session").set("Cookie", memberCookie).expect(200);
      await request(app).get("/api/auth/session").set("Cookie", memberCookie).expect(200);
      assert.equal(rosterCalls - before, 1);
      const raw = memberCookie.split("=")[1]!;
      const [row] = await testDb.select().from(sessions).where(eq(sessions.hash, hashToken(raw)));
      assert.equal(row!.expiresAt.getTime() - time.getTime(), 30 * DAY);
      time = new Date(time.getTime() + 2 * DAY); mode = "deny";
      await request(app).get("/api/home").set("Cookie", memberCookie).expect(401); mode = "allow";
    });
    await t.test("ending a grant immediately removes editor rights; history remains", async () => {
      const created = await request(app).post("/api/admin/grants").set("Cookie", adminCookie)
        .send({ personId: "synthetic-grant-end", displayName: "Synthetic End", role: "editor" }).expect(201);
      const signed = await login("grant-end@example.invalid");
      await request(app).get("/api/auth/session").set("Cookie", signed.cookie).expect(res => assert.equal(res.body.role, "editor"));
      await request(app).post(`/api/admin/grants/${created.body.id}/end`).set("Cookie", adminCookie).expect(200);
      await request(app).get("/api/auth/session").set("Cookie", signed.cookie).expect(res => assert.equal(res.body.role, "member"));
      const [historical] = await testDb.select().from(grants).where(eq(grants.id, created.body.id)); assert(historical!.endedAt);
    });
    await t.test("rate limits use visitor IP, not cookie; email limit shared across IPs; verify limit", async () => {
      const before = captured.length;
      for (let n = 0; n < 4; n++) await request(app).post("/api/auth/link").set("X-Forwarded-For", ip())
        .send({ email: "limited@example.invalid" }).expect(200);
      assert.equal(captured.length - before, 3);
      const repeated = "203.0.113.99"; const initial = captured.length;
      for (let n = 0; n < 6; n++) await request(app).post("/api/auth/link").set("X-Forwarded-For", repeated)
        .send({ email: `ip-limit-${n}@example.invalid` }).expect(200);
      assert.equal(captured.length - initial, 5);
      for (let n = 0; n < 10; n++) await request(app).post("/api/auth/verify").set("X-Forwarded-For", repeated)
        .send({ token: "0".repeat(64) }).expect(401);
      await request(app).post("/api/auth/verify").set("X-Forwarded-For", repeated).send({ token: "0".repeat(64) }).expect(429);
    });
    await t.test("cross-site requests, malformed JSON and bad IDs reveal no paths or traces", async () => {
      await request(app).post("/api/auth/link").set("Origin", "https://attacker.invalid")
        .send({ email: "nobody@example.invalid" }).expect(403);
      const bad = await request(app).post("/api/auth/verify").set("Content-Type", "application/json").send("{broken").expect(400);
      assert.doesNotMatch(JSON.stringify(bad.body), /stack|workspace|node_modules/);
      await request(app).get("/api/documents/not-a-uuid/open").set("Cookie", editorCookie).expect(400);
    });
    await t.test("sign-out removes the session, clears cookie, appends audit; old cookie refused", async () => {
      await request(app).post("/api/auth/sign-out").set("Cookie", editorCookie).expect(200)
        .expect(res => assert.match(res.headers["set-cookie"][0], /Expires=Thu, 01 Jan 1970/));
      await request(app).get("/api/home").set("Cookie", editorCookie).expect(401);
    });
    if (process.env.HWD_BROWSER_TEST === "1") await t.test("Chromium browser walkthrough: real UI, isolated API, stubbed Roster, console email", async () => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>(resolve => server.once("listening", resolve));
      const target = server.address(); assert(target && typeof target !== "string");
      const origin = "http://127.0.0.1";
      process.env.APP_ORIGIN = origin;
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/**", async route => {
        const url = new URL(route.request().url());
        const headers = { ...route.request().headers(), "x-forwarded-for": "192.0.2.200" };
        const response = await route.fetch({ url: `http://127.0.0.1:${target.port}${url.pathname}${url.search}`, headers });
        await route.fulfill({ response });
      });
      await mkdir("../../generated-artifacts", { recursive: true });
      try {
        await page.goto(`${origin}/sign-in`);
        await page.getByTestId("input-email").fill("browser@example.invalid");
        await page.getByTestId("button-request-link").click();
        await page.getByTestId("status-link-sent").waitFor();
        const token = new URL(captured.at(-1)!).searchParams.get("token")!;
        await page.goto(`${origin}/auth/continue?token=${token}`);
        await page.getByTestId("button-continue").waitFor();
        const [notUsed] = await testDb.select().from(loginTokens).where(eq(loginTokens.hash, hashToken(token)));
        assert.equal(notUsed!.usedAt, null, "GET page and JS gate must not consume token");
        await page.getByTestId("button-continue").click();
        await page.getByTestId("link-nav-meetings").waitFor();
        assert.equal(await page.getByTestId("link-nav-admin").count(), 0, "member never sees Admin");
        console.info("Browser: submitted sign-in; console link; Continue click signed in; member has no Admin");
        // Grant through the admin API, never by bypassing browser authentication.
        await request(app).post("/api/admin/grants").set("Cookie", adminCookie)
          .send({ personId: "synthetic-browser", displayName: "Synthetic Browser", role: "editor" }).expect(201);
        await page.reload();
        await page.getByTestId("link-nav-admin").filter({ visible: true }).click();
        await page.getByTestId("button-upload-pdf").click();
        await page.getByTestId("input-title").fill("Browser synthetic PDF");
        await page.getByTestId("input-year").fill("2026");
        await page.getByTestId("input-note").fill("Visible browser test note");
        await page.getByTestId("input-file").setInputFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: pdf });
        await page.getByTestId("button-save-document").click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        const [doc] = await testDb.select().from(documents).where(eq(documents.title, "Browser synthetic PDF"));
        assert(doc);
        await page.getByTestId(`row-document-${doc.id}`).waitFor();
        await page.getByTestId(`button-edit-${doc.id}`).click();
        await page.getByTestId("input-title").fill("Browser edited PDF");
        await page.getByTestId("button-save-document").click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await page.getByTestId(`button-replace-${doc.id}`).click();
        await page.getByTestId("input-file").setInputFiles({ name: "replacement.pdf", mimeType: "application/pdf", buffer: pdf });
        await page.getByTestId("button-save-document").click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        const [replaced] = await testDb.select().from(documents).where(eq(documents.replaces, doc.id)); assert(replaced);
        await page.getByTestId(`row-document-${replaced.id}`).waitFor();
        await page.goto(`${origin}/meetings/shareholders`);
        await page.getByText("Visible browser test note", { exact: true }).waitFor();
        await page.screenshot({ path: "../../generated-artifacts/hwd-desktop-members.jpg", fullPage: true });
        await page.goto(`${origin}/`);
        await page.getByTestId("link-nav-meetings").waitFor();
        await page.screenshot({ path: "../../generated-artifacts/hwd-home-desktop.jpg", fullPage: true });
        console.info("Browser: upload, metadata edit, replacement, meeting document and note all visible");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByTestId("button-menu").click();
        await page.getByTestId("link-nav-meetings").filter({ visible: true }).click();
        await page.getByRole("heading", { name: "Meetings", exact: true }).waitFor();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, "Phone layout must not overflow");
        await page.screenshot({ path: "../../generated-artifacts/hwd-phone-meetings.jpg", fullPage: true });
        await page.getByTestId("button-menu").click();
        await page.getByTestId("link-nav-admin").filter({ visible: true }).click();
        await page.getByTestId(`button-retire-${replaced.id}`).click();
        await page.getByTestId("button-confirm-retire").click();
        await page.getByRole("alertdialog").waitFor({ state: "hidden" });
        await page.getByTestId("switch-include-retired").click();
        await page.getByTestId(`row-document-${replaced.id}`).waitFor();
        await page.getByTestId("button-menu").click();
        await page.getByTestId("button-sign-out-mobile").click();
        await page.getByTestId("input-email").waitFor();
        console.info("Browser: phone menu, no overflow, retire/history and sign-out verified");
        assert.deepEqual(errors, [], "No uncaught browser exceptions");
      } finally {
        await page.close(); await browser.close();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
  } finally {
    await new Promise<void>((resolve, reject) => roster.close(error => error ? reject(error) : resolve()));
    await isolatedPool.end();
    await connection.query("RESET search_path"); connection.release(); await pool.end();
  }
});
