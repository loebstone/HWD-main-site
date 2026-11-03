import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@workspace/db/schema";
import { sessions, documents, documentGroups, auditLog } from "@workspace/db";
import { createApp } from "../src/app";
import { hashToken, newToken } from "../src/lib/auth";
import { DEFAULT_GROUPS, migrateDocumentGroups } from "../src/migrate-document-groups";
import { installDatabaseProtections } from "../src/install-security";
import { getFamilyTime } from "../src/lib/family-time";
import { homeDisplayInput } from "../src/lib/home-display";
import type { Services } from "../src/lib/services";

function rotation(year: number, familyGroupId = "synthetic-family-1") {
  return { year, yourFamily: { familyGroupId, familyName: "Synthetic family 1" },
    slots: [4, 2, 1, 3].map(n => ({ slotNumber: n, segmentIndex: 0, familyGroupId: `synthetic-family-${n}`,
      familyName: `Synthetic family ${n}`, displayColor: ["#244b39", "#946331", "#35678b", "#854963"][n - 1],
      startDate: `${year}-0${n + 4}-01`, endDate: `${year}-0${n + 5}-01`, isManualOverride: false })) };
}

test("Family time is private, cached per member for one hour, sorted, and moves to the next season", async () => {
  process.env.NODE_ENV = "test";
  process.env.SCHEDULER_BASE_URL = "https://scheduler.example.invalid";
  process.env.SITE_SERVICE_KEY = "synthetic-home-key";
  let now = new Date("2026-06-01T12:00:00Z");
  const calls: URL[] = [];
  const s = { now: () => new Date(now), schedulerFetch: async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.pathname, "/api/service/rotation");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-home-key");
    assert.equal(url.searchParams.get("email"), "nobody@example.invalid");
    const year = Number(url.searchParams.get("year"));
    return new Response(JSON.stringify({ ...rotation(year), email: "MUST-NOT-LEAK@example.invalid", private: "withheld" }));
  } } as Services;
  const first = await getFamilyTime(s, "nobody@example.invalid", "synthetic-person", "https://calendar.hwdfarm.com");
  assert.equal(first?.year, 2026);
  assert.deepEqual(first?.slots.map(slot => slot.slotNumber), [1, 2, 3, 4]);
  assert(!JSON.stringify(first).includes("email"));
  assert(!JSON.stringify(first).includes("private"));
  assert.equal(calls[0].searchParams.get("personId"), "synthetic-person");
  await Promise.all([getFamilyTime(s, "nobody@example.invalid", "synthetic-person", "/scheduler"),
    getFamilyTime(s, "nobody@example.invalid", "synthetic-person", "/scheduler")]);
  assert.equal(calls.length, 1);
  await getFamilyTime(s, "nobody@example.invalid", "synthetic-other", "/scheduler");
  assert.equal(calls.length, 2, "Do not share a member's yourFamily lookup with another person");
  now = new Date("2026-06-01T13:00:01Z");
  await getFamilyTime(s, "nobody@example.invalid", "synthetic-person", "/scheduler");
  assert.equal(calls.length, 3);
  now = new Date("2026-09-01T00:00:00Z"); // last slot's end is exclusive
  const next = await getFamilyTime(s, "nobody@example.invalid", "synthetic-person", "/scheduler");
  assert.equal(next?.year, 2027);
  assert.deepEqual(calls.slice(-2).map(url => url.searchParams.get("year")), ["2026", "2027"]);
});

test("Family time failures, empty slots, malformed data, missing settings and redirects are omitted", async () => {
  process.env.NODE_ENV = "test";
  process.env.SCHEDULER_BASE_URL = "https://scheduler.example.invalid";
  for (const fetcher of [
    async () => { throw new Error("timeout"); },
    async () => new Response("Unavailable", { status: 503 }),
    async () => new Response("", { status: 302, headers: { Location: "https://evil.example" } }),
    async () => new Response(JSON.stringify({ ...rotation(2026), slots: [] })),
    async () => new Response('{"year":2026,"slots":[{"invalid":true}]}'),
  ]) {
    const s = { now: () => new Date("2026-06-01Z"), schedulerFetch: fetcher } as Services;
    assert.equal(await getFamilyTime(s, "nobody@example.invalid", "synthetic", "/scheduler"), null);
  }
  delete process.env.SCHEDULER_BASE_URL;
  assert.equal(await getFamilyTime({ now: () => new Date() } as Services, "nobody@example.invalid", "synthetic", "/scheduler"), null);
});

test("slideshow validation allows only HTTPS SmugMug hosts; CSP changes only frame-src", async () => {
  for (const url of [null, "", "https://smugmug.com/slideshow", "https://family.smugmug.com/frame"]) {
    assert(homeDisplayInput.safeParse({ slideshowEmbedUrl: url }).success);
  }
  for (const url of ["http://family.smugmug.com/x", "https://smugmug.com.evil.example/x", "https://evilsmugmug.com",
    "javascript:alert(1)", "https://user:pass@family.smugmug.com/x", "https://family.smugmug.com:444/x"]) {
    assert(!homeDisplayInput.safeParse({ slideshowEmbedUrl: url }).success, url);
  }
  const vite = await readFile(new URL("../../hwd-main-site/vite.config.ts", import.meta.url), "utf8");
  assert.equal((vite.match(/frame-src 'self' https:\/\/\*\.smugmug\.com/g) ?? []).length, 2);
  // API/document CSP is not loosened, and no broad wildcard is introduced.
  assert(!vite.includes("frame-src *"));
  const appSource = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  assert(!appSource.includes("smugmug.com"));
});

test("Home and member-view: isolated synthetic development records", async t => {
  assert.notEqual(process.env.NODE_ENV, "production");
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "synthetic-home-session-key";
  process.env.APP_ORIGIN = "https://home.example.invalid";
  process.env.SITE_SERVICE_KEY = "synthetic-home-key";
  process.env.SCHEDULER_BASE_URL = "https://scheduler.example.invalid";
  console.info("Environment: development; configured host before query:", new URL(process.env.DATABASE_URL!).hostname);
  const root = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const isolated = `hwd_home_${randomUUID().replaceAll("-", "")}`;
  const target = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, options: `-c search_path=${isolated}` });
  console.info("Observed database:", (await root.query("SELECT current_database() AS database,inet_server_addr()::text AS server_address")).rows[0]);
  await root.query(`CREATE SCHEMA "${isolated}"`);
  for (const table of ["site_sessions", "site_grants", "site_documents", "site_document_groups", "site_data_migrations",
    "site_login_tokens", "site_settings", "site_announcements", "site_audit_log", "site_rate_limits"]) {
    await target.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
  }
  await installDatabaseProtections(target);
  await migrateDocumentGroups(target);
  const db = drizzle(target, { schema });
  const now = new Date("2026-06-01T12:00:00Z");
  const cookie = async (role: "admin" | "editor" | "member", apps: string[] | null, method: "roster" | "magic-link" = "roster") => {
    const raw = newToken(), personId = `synthetic-${randomUUID()}`;
    await db.insert(sessions).values({ hash: hashToken(raw), personId, displayName: "Synthetic, Alex",
      goesBy: "Alex", email: "nobody@example.invalid", signInMethod: method, rosterRole: method === "roster" ? role : null, rosterApps: apps,
      createdAt: now, expiresAt: new Date(now.getTime() + 30 * 86400000), lastRosterCheckAt: now,
      lastRosterSuccessAt: now, lastRenewedAt: now });
    if (method === "magic-link") await db.insert(schema.grants).values({ personId, role: "admin", displayName: "Synthetic Admin", grantedBy: "synthetic" });
    return { cookie: `site_session=${raw}`, personId, hash: hashToken(raw) };
  };
  const admin = await cookie("admin", ["site", "forecast", "captable"]);
  const member = await cookie("member", ["site"]);
  const editor = await cookie("editor", []);
  const legacyAdmin = await cookie("admin", null);
  const backdoor = await cookie("admin", ["forecast"], "magic-link");
  const app = createApp({ db, now: () => new Date(now),
    schedulerFetch: async input => new Response(JSON.stringify(rotation(Number(new URL(String(input)).searchParams.get("year"))))) });
  try {
    await t.test("new session flag has a safe false default, including existing-style inserts", async () => {
      assert.equal((await db.select().from(sessions).where(eq(sessions.hash, admin.hash)))[0].viewAsMember, false);
      const column = await target.query(`SELECT column_default,is_nullable FROM information_schema.columns
        WHERE table_schema=$1 AND table_name='site_sessions' AND column_name='view_as_member'`, [isolated]);
      assert.equal(column.rows[0].column_default, "false");
      assert.equal(column.rows[0].is_nullable, "NO");
    });
    await t.test("Home cards require explicit app entitlements; no admin fallback for cards", async () => {
      for (const identity of [member, legacyAdmin, editor]) {
        const res = await request(app).get("/api/home").set("Cookie", identity.cookie).expect(200);
        assert.deepEqual(res.body.cards.map((c: { id: string }) => c.id), ["scheduler", "directory", "documents", "contact"]);
        assert.equal(res.body.familyTime.year, 2026);
        assert(!JSON.stringify(res.body).includes("nobody@example.invalid"));
      }
      const res = await request(app).get("/api/home").set("Cookie", admin.cookie).expect(200);
      assert.deepEqual(res.body.cards.map((c: { id: string }) => c.id), ["scheduler", "directory", "documents", "contact", "forecast", "captable"]);
    });
    let staffGroupId = "", staffDocId = "";
    await t.test("latest minutes selects the newest live, visible document in the two original meeting groups", async () => {
      const insert = async (groupId: string, title: string, uploadedAt: Date, retiredAt: Date | null = null) => {
        const [doc] = await db.insert(documents).values({ groupId, title, type: "link", externalUrl: "https://example.invalid/",
          uploadedBy: "synthetic", uploadedByName: "Synthetic", uploadedAt, retiredAt }).returning();
        return doc!;
      };
      await insert(DEFAULT_GROUPS[0].id, "Synthetic older minutes", new Date("2026-01-01Z"));
      const latest = await insert(DEFAULT_GROUPS[1].id, "Synthetic latest minutes", new Date("2026-05-01Z"));
      await insert(DEFAULT_GROUPS[0].id, "Synthetic retired minutes", now, now);
      await insert(DEFAULT_GROUPS[2].id, "Synthetic newer governing record", now);
      const home = await request(app).get("/api/home").set("Cookie", member.cookie).expect(200);
      assert.equal(home.body.latestMinutes.id, latest.id);
      assert.equal(home.body.latestMinutes.storageKey, undefined);
      await db.update(documentGroups).set({ visibility: "staff" }).where(eq(documentGroups.id, DEFAULT_GROUPS[1].id));
      const filtered = await request(app).get("/api/home").set("Cookie", member.cookie).expect(200);
      assert.equal(filtered.body.latestMinutes.title, "Synthetic older minutes");
      await db.update(documentGroups).set({ visibility: "everyone" }).where(eq(documentGroups.id, DEFAULT_GROUPS[1].id));
      const [staff] = await db.insert(documentGroups).values({ name: "Synthetic staff", slug: "synthetic-staff", visibility: "staff",
        sortOrder: 20, createdBy: admin.personId }).returning();
      staffGroupId = staff!.id;
      staffDocId = (await insert(staffGroupId, "Synthetic staff secret", now)).id;
    });
    await t.test("member view persists server-side, refuses every staff route, hides staff data and restores access with audit", async () => {
      await request(app).post("/api/auth/view-as-member").set("Cookie", admin.cookie)
        .set("Origin", "https://evil.example").send({ enabled: true }).expect(403);
      for (const identity of [member, editor]) {
        await request(app).post("/api/auth/view-as-member").set("Cookie", identity.cookie).send({ enabled: true }).expect(403);
      }
      const changed = await request(app).post("/api/auth/view-as-member").set("Cookie", admin.cookie).send({ enabled: true }).expect(200);
      assert.equal(changed.body.role, "member");
      assert.equal(changed.body.viewAsMember, true);
      assert.deepEqual(changed.body.apps, ["site", "scheduler", "roster"]);
      assert.equal((await db.select().from(sessions).where(eq(sessions.hash, admin.hash)))[0].viewAsMember, true);
      await request(app).get("/api/auth/session").set("Cookie", admin.cookie).expect(200).expect(r => assert.equal(r.body.role, "member"));
      for (const path of ["/api/admin/grants", "/api/admin/audit", "/api/admin/suite-menu", "/api/admin/home",
        "/api/admin/home-display", "/api/admin/dues", "/api/admin/contact", "/api/admin/home-notice"]) {
        await request(app).get(path).set("Cookie", admin.cookie).expect(403);
      }
      await request(app).post("/api/admin/groups").set("Cookie", admin.cookie).send({}).expect(403);
      await request(app).put("/api/admin/dues").set("Cookie", admin.cookie).send({ seasonOpen: true, text: "forbidden" }).expect(403);
      await request(app).get("/api/groups/synthetic-staff").set("Cookie", admin.cookie).expect(404);
      await request(app).get(`/api/documents/${staffDocId}/open`).set("Cookie", admin.cookie).expect(404);
      const home = await request(app).get("/api/home").set("Cookie", admin.cookie).expect(200);
      assert(!JSON.stringify(home.body).includes(staffDocId));
      assert(!home.body.cards.some((c: { id: string }) => ["forecast", "captable"].includes(c.id)));
      await request(app).get("/api/admin/grants").set("Cookie", legacyAdmin.cookie).expect(200);
      // Repeated on doesn't create duplicate audit transitions.
      await request(app).post("/api/auth/view-as-member").set("Cookie", admin.cookie).send({ enabled: true }).expect(200);
      const restored = await request(app).post("/api/auth/view-as-member").set("Cookie", admin.cookie).send({ enabled: false }).expect(200);
      assert.equal(restored.body.role, "admin"); assert.equal(restored.body.viewAsMember, false);
      assert.deepEqual(restored.body.apps, ["site", "forecast", "captable"]);
      await request(app).get("/api/admin/grants").set("Cookie", admin.cookie).expect(200);
      await request(app).get("/api/groups/synthetic-staff").set("Cookie", admin.cookie).expect(200);
      await request(app).get(`/api/documents/${staffDocId}/open`).set("Cookie", admin.cookie).expect(302);
      const events = await db.select().from(auditLog).where(eq(auditLog.actorPersonId, admin.personId));
      assert.equal(events.filter(e => e.action === "view-as-member-on").length, 1);
      assert.equal(events.filter(e => e.action === "view-as-member-off").length, 1);
      // The back-door grants source supports the same mode without changing grants.
      await request(app).post("/api/auth/view-as-member").set("Cookie", backdoor.cookie).send({ enabled: true }).expect(200);
      await request(app).post("/api/auth/view-as-member").set("Cookie", backdoor.cookie).send({ enabled: false }).expect(200);
    });
    await t.test("slideshow admin validation, persistence, clearing and authorization", async () => {
      await request(app).get("/api/admin/home-display").set("Cookie", editor.cookie).expect(403);
      await request(app).put("/api/admin/home-display").set("Cookie", member.cookie).send({ slideshowEmbedUrl: null }).expect(403);
      const bad = await request(app).put("/api/admin/home-display").set("Cookie", admin.cookie)
        .send({ slideshowEmbedUrl: "https://smugmug.com.evil.example" }).expect(400);
      assert.match(bad.body.error, /HTTPS.*smugmug/);
      await request(app).put("/api/admin/home-display").set("Cookie", admin.cookie)
        .send({ slideshowEmbedUrl: "https://family.smugmug.com/frame" }).expect(200);
      await request(app).get("/api/home").set("Cookie", member.cookie).expect(200)
        .expect(r => assert.equal(r.body.slideshowEmbedUrl, "https://family.smugmug.com/frame"));
      await request(app).put("/api/admin/home-display").set("Cookie", admin.cookie).send({ slideshowEmbedUrl: null }).expect(200);
      await request(app).get("/api/admin/home-display").set("Cookie", admin.cookie).expect(200)
        .expect(r => assert.equal(r.body.slideshowEmbedUrl, null));
    });
    await t.test("dues season controls card and instructions on the server, persists and audits settings", async () => {
      await request(app).get("/api/dues").expect(401);
      await request(app).put("/api/admin/dues").set("Cookie", editor.cookie).send({ seasonOpen: true, text: "forbidden" }).expect(403);
      for (const seasonOpen of [true, false]) {
        const text = "Synthetic dues instructions https://example.invalid/pay";
        await request(app).put("/api/admin/dues").set("Cookie", admin.cookie).send({ seasonOpen, text }).expect(200);
        const saved = await request(app).get("/api/admin/dues").set("Cookie", admin.cookie).expect(200);
        assert.deepEqual(saved.body, { seasonOpen, text });
        const memberDues = await request(app).get("/api/dues").set("Cookie", member.cookie).expect(200);
        assert.deepEqual(memberDues.body, { seasonOpen, text: seasonOpen ? text : "" });
        const home = await request(app).get("/api/home").set("Cookie", member.cookie).expect(200);
        assert.equal(home.body.cards.some((c: { id: string }) => c.id === "dues"), seasonOpen);
      }
      const events = await db.select().from(auditLog).where(eq(auditLog.action, "dues-settings-edit"));
      assert.equal(events.length, 2);
      assert(events.every(event => !event.description.includes("instructions")));
    });
  } finally {
    await target.end();
    await root.query(`DROP SCHEMA "${isolated}" CASCADE`);
    await root.end();
  }
});
