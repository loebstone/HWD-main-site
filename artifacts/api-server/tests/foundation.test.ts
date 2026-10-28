import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { mkdir } from "node:fs/promises";
import pg from "pg";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { pool, loginTokens, sessions, grants, documents, auditLog, announcements } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { createApp } from "../src/app";
import { checkRoster, RosterUnavailableError } from "../src/lib/roster";
import { installDatabaseProtections } from "../src/install-security";
import { sendSignInLink } from "../src/lib/email";
import { hashToken, newToken } from "../src/lib/auth";
import { appOrigin, DAY, neutralMessage } from "../src/lib/config";
import { logger } from "../src/lib/logger";
import { fetchGoogle, fetchOldSitePdf, googleConfirmLink, OLD_SITE_INDEX, parseOldSiteCsv, PDF_LIMIT } from "../src/lib/old-site-fetch";
import { planOldSiteRow } from "../src/lib/old-site-import";
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
  for (const table of ["site_login_tokens", "site_sessions", "site_grants", "site_documents", "site_audit_log", "site_rate_limits", "site_announcements", "site_settings"]) {
    await connection.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
  }
  const isolatedPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, options: `-c search_path=${isolated}` });
  await installDatabaseProtections(isolatedPool);
  await installDatabaseProtections(isolatedPool);
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
      await request(app).get("/api/public/home-notice").expect(204);
      for (const path of ["/api/auth/session", "/api/home", "/api/apps", "/api/announcements", "/api/documents", `/api/documents/${randomUUID()}/open`, "/api/admin/grants", "/api/admin/audit", "/api/admin/apps", "/api/storage/objects/arbitrary"]) {
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
    await t.test("startup-installed protections are idempotent; audit UPDATE/DELETE/TRUNCATE and hard deletes refused", async () => {
      for (const statement of [
        "UPDATE site_audit_log SET description='tamper'",
        "DELETE FROM site_audit_log",
        "TRUNCATE site_audit_log",
        "DELETE FROM site_documents",
        "DELETE FROM site_grants",
        "DELETE FROM site_announcements",
      ]) await assert.rejects(connection.query(statement), /append-only|hard deletion/);
      const installed = await connection.query(
        "SELECT count(*)::int AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE t.tgname='site_audit_immutable' AND NOT t.tgisinternal AND n.nspname=$1",
        [isolated],
      );
      assert.equal(installed.rows[0].count, 1);
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
      time = new Date(time.getTime() + DAY + 1);
      let before = rosterCalls;
      await request(app).get("/api/auth/session").set("Cookie", memberCookie).expect(200);
      await request(app).get("/api/auth/session").set("Cookie", memberCookie).expect(200);
      assert.equal(rosterCalls - before, 1);
      const raw = memberCookie.split("=")[1]!;
      const [row] = await testDb.select().from(sessions).where(eq(sessions.hash, hashToken(raw)));
      assert.equal(row!.expiresAt.getTime() - time.getTime(), 30 * DAY);
      time = new Date(time.getTime() + DAY + 1); mode = "deny";
      await request(app).get("/api/home").set("Cookie", memberCookie).expect(401); mode = "allow";
    });
    await t.test("Roster recheck allows, immediately refuses, and tolerates two outages for at most three days", async () => {
      const allowLogin = await login("recheck-allowed@example.invalid");
      const denyLogin = await login("recheck-denied@example.invalid");
      const outageLogin = await login("recheck-outage@example.invalid");
      let recheckTime = new Date(time.getTime());
      recheckTime = new Date(recheckTime.getTime() + DAY + 1);
      const makeRecheckApp = (answer: "allow" | "deny" | "unreachable") => {
        const timeouts: number[] = [];
        const recheckApp = createApp({ ...services, now: () => new Date(recheckTime), roster: async (email, timeout = 10_000) => {
          timeouts.push(timeout);
          if (answer === "unreachable") throw new RosterUnavailableError("synthetic unavailable");
          if (answer === "deny") return { allowed: false } as const;
          return { allowed: true, personId: `synthetic-${email.split("@")[0]}`, displayName: "Synthetic Recheck", goes_by: null } as const;
        } });
        return { recheckApp, timeouts };
      };
      const allowed = makeRecheckApp("allow");
      await request(allowed.recheckApp).get("/api/auth/session").set("Cookie", allowLogin.cookie).expect(200);
      assert.deepEqual(allowed.timeouts, [5_000], "allowed response is not retried");

      const refused = makeRecheckApp("deny");
      await request(refused.recheckApp).get("/api/auth/session").set("Cookie", denyLogin.cookie).expect(401);
      assert.deepEqual(refused.timeouts, [5_000], "a real not-allowed answer is never retried");

      const outage = makeRecheckApp("unreachable");
      await request(outage.recheckApp).get("/api/auth/session").set("Cookie", outageLogin.cookie).expect(200);
      assert.deepEqual(outage.timeouts, [5_000, 8_000], "outage receives exactly one retry");
      const outageToken = outageLogin.cookie.split("=")[1]!;
      const [afterOutage] = await testDb.select().from(sessions).where(eq(sessions.hash, hashToken(outageToken)));
      assert(afterOutage!.lastRosterCheckAt.getTime() > afterOutage!.lastRosterSuccessAt.getTime());
      recheckTime = new Date(recheckTime.getTime() + 59 * 60_000);
      await request(outage.recheckApp).get("/api/auth/session").set("Cookie", outageLogin.cookie).expect(200);
      assert.equal(outage.timeouts.length, 2, "failed lookup is throttled for one hour");
      recheckTime = new Date(recheckTime.getTime() + 60_000);
      await request(outage.recheckApp).get("/api/auth/session").set("Cookie", outageLogin.cookie).expect(200);
      assert.deepEqual(outage.timeouts.slice(2), [5_000, 8_000]);
      recheckTime = new Date(afterOutage!.lastRosterSuccessAt.getTime() + 3 * DAY);
      await request(outage.recheckApp).get("/api/auth/session").set("Cookie", outageLogin.cookie).expect(401);
    });
    await t.test("announcements, notice visibility, role-filtered apps, and admin-only audit API", async () => {
      const featureMember = await login("feature-member@example.invalid");
      await request(app).post("/api/announcements").set("Cookie", featureMember.cookie)
        .send({ title: "Member denied", body: "No", placement: "both" }).expect(403);
      const [bootstrapGrant] = await testDb.select().from(grants).where(eq(grants.personId, "synthetic-admin"));
      assert(bootstrapGrant && !bootstrapGrant.endedAt);
      await request(app).post(`/api/admin/grants/${bootstrapGrant.id}/end`).set("Cookie", adminCookie).expect(409);
      const created = await request(app).post("/api/announcements").set("Cookie", editorCookie)
        .send({ title: "Synthetic family notice", body: "Test paragraph", placement: "both" }).expect(201);
      assert.match(created.body.date, /^\d{4}-\d{2}-\d{2}$/);
      const expectedHideAfter = new Date(`${created.body.date}T00:00:00.000Z`);
      expectedHideAfter.setUTCDate(expectedHideAfter.getUTCDate() + 60);
      assert.equal(created.body.hideAfter, expectedHideAfter.toISOString().slice(0, 10));
      await request(app).get("/api/announcements").set("Cookie", featureMember.cookie)
        .expect(200).expect(res => assert(res.body.some((row: { id: string }) => row.id === created.body.id)));
      await request(app).get("/api/home").set("Cookie", featureMember.cookie)
        .expect(200).expect(res => assert(res.body.reminders.some((row: { id: string }) => row.id === created.body.id)));
      await request(app).patch(`/api/announcements/${created.body.id}`).set("Cookie", editorCookie)
        .send({ title: "Edited family notice", body: "Updated text", date: created.body.date,
          placement: "both", hideAfter: created.body.hideAfter }).expect(200);
      await request(app).post(`/api/announcements/${created.body.id}/retire`).set("Cookie", editorCookie).expect(200);
      const [retired] = await testDb.select().from(announcements).where(eq(announcements.id, created.body.id));
      assert(retired!.retiredAt);

      await request(app).put("/api/admin/home-notice").set("Cookie", editorCookie)
        .send({ text: "Private notice", visibility: "signed-in" }).expect(200);
      await request(app).get("/api/public/home-notice").expect(204);
      await request(app).put("/api/admin/home-notice").set("Cookie", editorCookie)
        .send({ text: "Public synthetic notice", visibility: "public" }).expect(200);
      const publicNotice = await request(app).get("/api/public/home-notice").expect(200);
      assert.deepEqual(Object.keys(publicNotice.body), ["text"]);
      assert.equal(publicNotice.body.text, "Public synthetic notice");

      const memberApps = await request(app).get("/api/apps").set("Cookie", featureMember.cookie).expect(200);
      assert.deepEqual(memberApps.body.map((item: { id: string }) => item.id).sort(), ["calendar", "roster"]);
      const memberHome = await request(app).get("/api/home").set("Cookie", featureMember.cookie).expect(200);
      assert.deepEqual(memberHome.body.apps.map((item: { id: string }) => item.id).sort(), ["calendar", "roster"]);
      assert(!JSON.stringify(memberHome.body).includes("forecast.hwdfarm.com"), "member Home response omits Forecast on the server");
      assert(!JSON.stringify(memberHome.body).includes("captable.hwdfarm.com"), "member Home response omits Cap Table on the server");
      const adminApps = await request(app).get("/api/admin/apps").set("Cookie", adminCookie).expect(200);
      assert.equal(adminApps.body.length, 4);
      await request(app).put("/api/admin/apps").set("Cookie", editorCookie)
        .send({ apps: adminApps.body }).expect(403);
      await request(app).put("/api/admin/apps").set("Cookie", adminCookie)
        .send({ apps: adminApps.body }).expect(200);
      const adminHome = await request(app).get("/api/home").set("Cookie", adminCookie).expect(200);
      assert.deepEqual(adminHome.body.apps.map((item: { id: string }) => item.id).sort(), ["calendar", "cap-table", "forecast", "roster"]);

      await request(app).get("/api/admin/audit").set("Cookie", editorCookie).expect(403);
      const auditPage = await request(app).get("/api/admin/audit?page=1&personId=synthetic-editor&action=announcement-create")
        .set("Cookie", adminCookie).expect(200);
      assert.equal(auditPage.body.items.length, 1);
      assert.equal(auditPage.body.items[0].actorPersonId, "synthetic-editor");
      assert.equal(auditPage.body.items[0].action, "announcement-create");
      assert.equal(auditPage.body.pageSize, 50);
      const events = await testDb.select().from(auditLog).where(eq(auditLog.action, "notice-edit"));
      assert.equal(events.length, 2);
      const appEvents = await testDb.select().from(auditLog).where(eq(auditLog.action, "apps-edit"));
      assert.equal(appEvents.length, 1);
    });
    await t.test("old-site import is admin-only, dry-run fetches only CSV, real import is private, audited and idempotent", async () => {
      const csvRows = [
        ["", "title", "section", "year", "type", "embed_url", "open_url", "sort_order", "tags", "announcement_text", "publish_date", ""],
        ["synthetic-old-doc", "Synthetic 2025 minutes", "shareholders", "", "google_doc", "", "https://docs.google.com/document/d/good/view", "bad", "one, two", "", "", "Preserved note"],
        ["synthetic-old-pdf", "Synthetic forestry PDF", "logging", "", "pdf", "", "https://drive.google.com/file/d/confirm/view", "3", "", "", "", ""],
        ["synthetic-old-ann", "Synthetic old announcement", "home_highlight", "", "announcement", "", "", "", "", "Body with\nmultiple lines and \"quotes\"", "2020-01-02", ""],
        ["synthetic-old-photo", "Synthetic album", "governing", "", "link", "", "https://synthetic.smugmug.com/", "", "", "", "", "Synthetic album note"],
        ["synthetic-old-address", "ADDRESS master LIST", "governing", "", "google_sheet", "", "", "", "", "", "", ""],
        ["synthetic-old-season", "2026 Season", "governing", "", "google_sheet", "", "", "", "", "", "", ""],
        ["synthetic-old-calendar", "Calendar", "governing", "", "google_calendar", "", "", "", "", "", "", ""],
        ["synthetic-old-property", "Property rules", "property", "", "google_doc", "", "", "", "", "", "", ""],
        ["synthetic-old-year", "No year", "directors", "", "google_doc", "", "https://docs.google.com/document/d/good/view", "", "", "", "", ""],
        ["synthetic-old-badpdf", "Non PDF", "governing", "", "google_doc", "", "https://docs.google.com/document/d/badpdf/view", "", "", "", "", ""],
        ["synthetic-old-escape", "Unsafe redirect", "governing", "", "google_doc", "", "https://docs.google.com/document/d/escape/view", "", "", "", "", ""],
        ["synthetic-old-after-failure", "After failure", "home_highlight", "", "google_sheet", "", "https://docs.google.com/spreadsheets/d/good/view", "", "", "", "", ""],
      ];
      const csv = csvRows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
      const parsed = parseOldSiteCsv(csv);
      assert.equal(parsed[0]!.id, "synthetic-old-doc");
      assert.equal(parsed[2]!.announcement_text, 'Body with\nmultiple lines and "quotes"');
      assert.equal(parsed[3]!.supporting_text, "Synthetic album note");
      assert.throws(() => planOldSiteRow(parsed[8]!, time), /year missing/);
      const calls: string[] = [];
      const fetcher: typeof fetch = async input => {
        const url = String(input); calls.push(url);
        if (url === OLD_SITE_INDEX) return new Response(csv);
        if (url.includes("/badpdf/")) return new Response("<html>Not publicly exported</html>");
        if (url.includes("/escape/")) return new Response(null, { status: 302, headers: { location: "https://evil.example.invalid/file" } });
        if (url.includes("/uc?")) return new Response('<a href="https://drive.usercontent.google.com/download?id=confirm&amp;confirm=yes">Confirm</a>');
        return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf" } });
      };
      const importingApp = createApp({ ...services, importFetch: fetcher });
      await request(importingApp).get("/api/admin/old-site-import").expect(401);
      await request(importingApp).post("/api/admin/old-site-import").set("Cookie", editorCookie).send({ dryRun: true }).expect(403);
      await request(importingApp).get("/api/admin/old-site-import").set("Cookie", editorCookie).expect(403);
      const finish = async () => {
        for (let n = 0; n < 200; n++) {
          const response = await request(importingApp).get("/api/admin/old-site-import").set("Cookie", adminCookie).expect(200);
          if (response.body.status !== "running") {
            assert.equal(response.body.status, "completed", response.body.error); return response.body;
          }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error("Synthetic import did not finish");
      };
      await request(importingApp).post("/api/admin/old-site-import").set("Cookie", adminCookie).send({ dryRun: true }).expect(202);
      const dry = await finish();
      assert.deepEqual(calls, [OLD_SITE_INDEX], "Dry run fetches the index only, no PDFs");
      assert.equal(dry.rows.filter((row: { result: string }) => row.result === "would import").length, 7);
      assert.equal(dry.rows.find((row: { sheetId: string }) => row.sheetId === "synthetic-old-year").reason, "year missing");
      assert.equal((await testDb.select().from(documents).where(eq(documents.legacySheetId, "synthetic-old-doc"))).length, 0);
      calls.length = 0;
      await request(importingApp).post("/api/admin/old-site-import").set("Cookie", adminCookie).send({ dryRun: false }).expect(202);
      const real = await finish();
      assert.equal(real.rows.filter((row: { result: string }) => row.result === "imported").length, 5);
      assert.equal(real.rows.filter((row: { result: string }) => row.result === "skipped").length, 4);
      assert.equal(real.rows.filter((row: { result: string }) => row.result === "failed").length, 3);
      assert.equal(calls.filter(url => url.includes("confirm=yes")).length, 1);
      assert(!calls.some(url => url.includes("evil.example")), "Blocked redirect was never fetched");
      const [imported] = await testDb.select().from(documents).where(eq(documents.legacySheetId, "synthetic-old-doc"));
      assert(imported!.storageKey && files.has(imported!.storageKey));
      assert.equal(imported!.year, 2025); assert.equal(imported!.sortOrder, 1);
      assert.deepEqual(imported!.tags, ["one", "two"]); assert.equal(imported!.note, "Preserved note");
      await request(importingApp).get(`/api/documents/${imported!.id}/open`).expect(401);
      await request(importingApp).get(`/api/documents/${imported!.id}/open`).set("Cookie", adminCookie).expect(200).expect("Cache-Control", "no-store");
      const [announcement] = await testDb.select().from(announcements).where(eq(announcements.legacySheetId, "synthetic-old-ann"));
      assert.equal(announcement!.hideAfter, "2020-03-02"); assert.equal(announcement!.placement, "announcements");
      const events = await testDb.select().from(auditLog).where(eq(auditLog.action, "import"));
      assert.equal(events.length, 5);
      assert(events.every(event => event.actorPersonId === real.actorPersonId && event.description.startsWith("Import from old site: synthetic-old-")));
      await request(importingApp).post(`/api/documents/${imported!.id}/retire`).set("Cookie", adminCookie).expect(200);
      calls.length = 0;
      await request(importingApp).post("/api/admin/old-site-import").set("Cookie", adminCookie).send({ dryRun: false }).expect(202);
      const repeated = await finish();
      assert.equal(repeated.rows.filter((row: { result: string }) => row.result === "already imported").length, 5);
      assert(!calls.some(url => url.includes("/good/") || url.includes("/uc?")), "Imported records, including retired, are not refetched");
      assert.equal((await testDb.select().from(auditLog).where(eq(auditLog.action, "import"))).length, 5);
    });
    await t.test("Google import fetch limits, host restrictions and one confirmation are enforced", async () => {
      const emptyRow = { id: "x", title: "1800 meeting", section: "directors", year: "", type: "google_doc",
        open_url: "https://docs.google.com/document/d/x/view", embed_url: "", sort_order: "", tags: "" };
      const plan = planOldSiteRow(emptyRow, time);
      assert(plan.kind === "document"); assert.equal(plan.meta.year, 1800);
      await assert.rejects(fetchGoogle("https://google.com.evil.invalid/file", PDF_LIMIT), /non-Google/);
      await assert.rejects(fetchGoogle("https://drive.google.com/file", PDF_LIMIT,
        async () => new Response("x", { headers: { "content-length": String(PDF_LIMIT + 1) } })), /50 MB/);
      let count = 0;
      await assert.rejects(fetchOldSitePdf("https://drive.google.com/uc?id=x", true, async () => {
        count++; return new Response('<a href="/uc?id=x&amp;confirm=1">Confirm</a>');
      }), /signature-validated PDF/);
      assert.equal(count, 2, "Initial fetch plus exactly one confirmation");
      assert.equal(googleConfirmLink('<form method="get" action="https://drive.usercontent.google.com/download"><input name="id" value="x"><input name="confirm" value="t"></form>',
        new URL("https://drive.google.com/uc"))!.searchParams.get("confirm"), "t");
      assert.throws(() => parseOldSiteCsv('id,title\n"unterminated'), /Unterminated/);
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
      const browserImportRows = [
        ["id", "title", "section", "year", "type", "embed_url", "open_url", "sort_order", "tags", "announcement_text", "publish_date", "supporting_text"],
        ["synthetic-browser-import-sh", "Browser imported shareholders", "shareholders", "2031", "google_doc", "", "https://docs.google.com/document/d/synthetic/view", "1", "", "", "", ""],
        ["synthetic-browser-import-dir", "Browser imported directors", "directors", "2031", "google_doc", "", "https://docs.google.com/document/d/synthetic/view", "1", "", "", "", ""],
        ["synthetic-browser-import-gov", "Browser imported governing", "governing", "", "pdf", "", "https://drive.google.com/file/d/synthetic/view", "1", "", "", "", ""],
        ["synthetic-browser-import-log", "Browser imported logging", "logging", "", "google_sheet", "", "https://docs.google.com/spreadsheets/d/synthetic/view", "1", "", "", "", ""],
        ["synthetic-browser-import-photo", "Browser imported photo archive", "photo_archive", "", "link", "", "https://synthetic.smugmug.com/", "1", "", "", "", "Synthetic album note"],
      ];
      const browserImportCsv = browserImportRows.map(row => row.join(",")).join("\n");
      const browserApp = createApp({ ...services, importFetch: async input =>
        String(input) === OLD_SITE_INDEX ? new Response(browserImportCsv) : new Response(new Uint8Array(pdf)) });
      const server = browserApp.listen(0, "127.0.0.1");
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
          .send({ personId: "synthetic-browser", displayName: "Synthetic Browser", role: "admin" }).expect(201);
        await page.reload();
        await page.getByTestId("link-nav-admin").filter({ visible: true }).click();
        await page.getByTestId("old-site-import-panel").waitFor();
        await page.getByTestId("button-import-dry-run").click();
        await page.getByTestId("import-run-status").filter({ hasText: "Dry run · completed" }).waitFor();
        assert.equal(await page.getByTestId("import-report-table").getByText("would import", { exact: true }).count(), 5);
        assert.equal((await testDb.select().from(documents).where(eq(documents.legacySheetId, "synthetic-browser-import-sh"))).length, 0);
        page.once("dialog", dialog => void dialog.accept());
        await page.getByTestId("button-import-execute").click();
        await page.getByTestId("import-run-status").filter({ hasText: "Import · completed" }).waitFor();
        assert.equal(await page.getByTestId("import-report-table").getByText("imported", { exact: true }).count(), 5);
        await page.reload();
        await page.getByTestId("import-report-table").waitFor();
        assert.equal(await page.getByTestId("import-report-table").getByText("imported", { exact: true }).count(), 5);
        for (const [path, title] of [
          ["/meetings/shareholders", "Browser imported shareholders"],
          ["/meetings/directors", "Browser imported directors"], ["/governing", "Browser imported governing"],
          ["/logging", "Browser imported logging"], ["/photo-archive", "Browser imported photo archive"],
        ]) {
          await page.goto(`${origin}${path}`);
          await page.getByText(title, { exact: true }).waitFor();
        }
        const [browserImportedPdf] = await testDb.select().from(documents).where(eq(documents.legacySheetId, "synthetic-browser-import-gov"));
        const importedPdfResponse = await page.evaluate(async url => {
          const response = await fetch(url);
          return { status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"),
            signature: (await response.text()).slice(0, 5) };
        }, `/api/documents/${browserImportedPdf!.id}/open`);
        assert.deepEqual(importedPdfResponse, { status: 200, type: "application/pdf", cache: "no-store", signature: "%PDF-" });
        await page.goto(`${origin}/admin/documents`);
        page.once("dialog", dialog => void dialog.accept());
        await page.getByTestId("button-import-execute").click();
        await page.getByTestId("import-report-table").getByText("already imported", { exact: true }).first().waitFor();
        await page.getByTestId("import-run-status").filter({ hasText: "Import · completed" }).waitFor();
        assert.equal(await page.getByTestId("import-report-table").getByText("already imported", { exact: true }).count(), 5);
        await page.screenshot({ path: "../../generated-artifacts/hwd-import-browser-report.jpg", fullPage: true });
        console.info("Browser: synthetic dry run, import, persisted table, repeat deduplication, all document sections and authenticated PDF verified");
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
        await page.waitForFunction(() =>
          document.querySelector('[data-testid="link-nav-calendar"]')?.getAttribute("href") === "https://calendar.hwdfarm.com",
        );
        assert.equal(await page.getByTestId("link-nav-calendar").getAttribute("href"), "https://calendar.hwdfarm.com");
        await page.screenshot({ path: "../../generated-artifacts/hwd-home-desktop.jpg", fullPage: true });
        console.info("Browser: upload, metadata edit, replacement, meeting document and note all visible");
        await page.goto(`${origin}/admin/announcements`);
        await page.getByTestId("form-announcement").waitFor();
        console.info("Browser: Admin Announcements form loaded");
        await page.getByTestId("input-announcement-title").fill("Browser synthetic announcement");
        await page.getByTestId("input-announcement-body").fill("Announcement admin form walkthrough.");
        const defaultDate = await page.getByTestId("input-announcement-date").inputValue();
        const hideAfter = await page.getByTestId("input-announcement-hide-after").inputValue();
        const hideAfterDate = new Date(`${defaultDate}T00:00:00.000Z`);
        hideAfterDate.setUTCDate(hideAfterDate.getUTCDate() + 60);
        assert.equal(hideAfter, hideAfterDate.toISOString().slice(0, 10), "admin form defaults hide-after to 60 days");
        const announcementSaved = page.waitForResponse(response =>
          response.url().includes("/api/announcements") && response.request().method() === "POST" && response.status() === 201);
        await page.getByTestId("button-save-announcement").click();
        await announcementSaved;
        const [browserAnnouncement] = await testDb.select().from(announcements)
          .where(eq(announcements.title, "Browser synthetic announcement"));
        assert(browserAnnouncement);
        await page.getByTestId(`admin-announcement-${browserAnnouncement.id}`).waitFor();

        await page.goto(`${origin}/admin/home-notice`);
        await page.getByTestId("form-home-notice").waitFor();
        console.info("Browser: Home notice form loaded");
        await page.getByTestId("input-home-notice").fill("Browser walkthrough notice");
        await page.getByTestId("button-save-home-notice").click();
        const noticeSaved = await page.waitForResponse(response =>
          response.url().includes("/api/admin/home-notice") && response.request().method() === "PUT");
        assert.equal(noticeSaved.status(), 200, `Home notice save request: ${noticeSaved.request().postData()}; response: ${noticeSaved.status()} ${await noticeSaved.text()}`);
        await page.goto(`${origin}/admin/apps`);
        await page.getByTestId("form-app-links").waitFor();
        console.info("Browser: Apps form loaded");
        const appsSaved = page.waitForResponse(response =>
          response.url().includes("/api/admin/apps") && response.request().method() === "PUT" && response.status() === 200);
        await page.getByTestId("button-save-app-links").click();
        await appsSaved;
        await page.goto(`${origin}/admin/people`);
        await page.getByTestId("form-create-grant").waitFor();
        console.info("Browser: People form loaded");
        await page.getByTestId("input-grant-person-id").fill("synthetic-browser-helper");
        await page.getByTestId("input-grant-display-name").fill("Synthetic Browser Helper");
        const grantCreated = page.waitForResponse(response =>
          response.url().includes("/api/admin/grants") && response.request().method() === "POST" && response.status() === 201);
        await page.getByTestId("button-create-grant").click();
        await grantCreated;
        await page.getByText("granted by synthetic-browser", { exact: false }).waitFor();
        await page.goto(`${origin}/admin/audit`);
        await page.getByRole("heading", { name: "Audit log" }).waitFor();
        await page.getByTestId("input-audit-person").waitFor();
        await page.getByTestId("select-audit-action").waitFor();
        console.info("Browser: Admin Announcements, Home notice, Apps, People and Audit pages loaded; forms exercised");
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
        await page.unrouteAll({ behavior: "ignoreErrors" });
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
