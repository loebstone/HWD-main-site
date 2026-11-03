import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { pool, sessions, auditLog } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { createApp } from "../src/app";
import { createSession, hashToken } from "../src/lib/auth";
import { DAY } from "../src/lib/config";
import { logger } from "../src/lib/logger";
import { sendContactMail, type ContactMail } from "../src/lib/email";
import { DEFAULT_CONTACT_TEXT } from "../src/routes/contact";
import { toolAllowed, isSuiteHref, logoSvg } from "../src/lib/suite-menu";
import { installDatabaseProtections } from "../src/install-security";
import type { Services } from "../src/lib/services";
import type { RedeemedIdentity } from "../src/lib/roster";

test("Suite menu and Contact: isolated development-only records", async t => {
  assert.notEqual(process.env.NODE_ENV, "production");
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "synthetic-suite-secret";
  process.env.MAIL_FROM = "Synthetic Farm <nobody@example.invalid>";
  process.env.APP_ORIGIN = "https://hwdfarm.com";
  process.env.ROSTER_BASE_URL = "https://roster.hwdfarm.com";
  logger.level = "silent";
  console.info("Environment: development; configured database host before query:", new URL(process.env.DATABASE_URL!).hostname);
  const control = await pool.connect();
  console.info("Observed by query:", (await control.query("SELECT current_database() AS database, inet_server_addr()::text AS address")).rows);
  const isolated = `hwd_suite_${randomUUID().replace(/-/g, "")}`;
  await control.query(`CREATE SCHEMA "${isolated}"`);
  await control.query(`SET search_path TO "${isolated}"`);
  for (const table of ["site_login_tokens", "site_sessions", "site_grants", "site_document_groups", "site_data_migrations",
    "site_documents", "site_audit_log", "site_rate_limits", "site_announcements", "site_settings"]) {
    await control.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
  }
  const isolatedPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${isolated}` });
  const db = drizzle(isolatedPool, { schema });
  const delivered: ContactMail[] = [];
  const rosterPeople = new Map<string, { personId: string; apps?: string[] }>();
  const tickets = new Map<string, RedeemedIdentity>();
  let now = new Date();
  let failMail = false;
  let rosterCalls = 0;
  const s: Services = {
    db, now: () => new Date(now),
    roster: async email => {
      rosterCalls++;
      const person = rosterPeople.get(email);
      return person ? { allowed: true, ...person, displayName: "Synthetic Suite Person", goes_by: "Sam" } : { allowed: false };
    },
    redeemTicket: async token => { const value = tickets.get(token); tickets.delete(token); return value ?? null; },
    email: async () => { throw new Error("Magic links not needed in this fixture"); },
    contactEmail: async mail => { if (failMail) throw new Error("Synthetic mail failure"); delivered.push(mail); },
    storage: { async save() { throw new Error("No files in Contact test"); }, async read() { throw new Error("No files in Contact test"); } },
  };
  const app = createApp(s);
  async function signIn(role: "member" | "editor" | "admin", apps?: string[]) {
    const personId = `synthetic-suite-${randomUUID()}`;
    const answer = { personId, displayName: "Synthetic Suite Person", goes_by: "Sam",
      email: `${personId}@example.invalid`, apps };
    rosterPeople.set(answer.email, { personId, apps });
    const result = await createSession(s, answer, "192.0.2.1",
      { ...answer, rosterAdmin: role === "admin", role, authenticated_at: now.toISOString() });
    return { cookie: `site_session=${result.raw}`, answer, result };
  }
  try {
    await installDatabaseProtections(isolatedPool);
    const admin = await signIn("admin");
    const member = await signIn("member", []);
    const editor = await signIn("editor", []);
    await t.test("default public menu has exact order/shape, immutable safe SVG, public caching and no personal data", async () => {
      const response = await request(app).get("/api/suite/menu").expect(200);
      assert.deepEqual(Object.keys(response.body).sort(), ["version", "logoSvg", "items", "tools", "signOutHref"].sort());
      assert.equal(response.body.version, 1);
      assert.deepEqual(response.body.items.map((i: { label: string }) => i.label),
        ["Home", "Announcements", "Scheduler", "Family Directory", "Documents", "Contact"]);
      assert.deepEqual(response.body.items.map((i: { order: number }) => i.order), [0, 1, 2, 3, 4, 5]);
      for (const item of response.body.items) assert.deepEqual(Object.keys(item).sort(), ["id", "label", "href", "order"].sort());
      for (const tool of response.body.tools) assert.deepEqual(Object.keys(tool).sort(), ["id", "label", "href"].sort());
      assert.deepEqual(response.body.tools.map((i: { id: string }) => i.id), ["forecast", "captable"]);
      assert.equal(response.body.signOutHref, "https://roster.hwdfarm.com/sign-out");
      assert.equal(response.body.logoSvg, logoSvg);
      assert.equal((logoSvg.match(/<path /g) ?? []).length, 8);
      assert(!/script|onload|foreignObject|http.*href/.test(logoSvg));
      assert.equal(response.headers["cache-control"], "public, max-age=300");
      assert.equal(response.headers["set-cookie"], undefined);
      const signed = await request(app).get("/api/suite/menu").set("Cookie", admin.cookie).expect(200);
      assert.deepEqual(signed.body, response.body);
      assert(!JSON.stringify(response.body).includes("synthetic-suite-"));
    });
    await t.test("CORS allows Farm subdomains, denies unregistered Replit tenants; GET-only", async () => {
      for (const origin of ["https://calendar.hwdfarm.com", "https://hwdfarm.com"]) {
        const res = await request(app).get("/api/suite/menu").set("Origin", origin).expect(200);
        assert.equal(res.headers["access-control-allow-origin"], origin);
        assert.equal(res.headers["access-control-allow-methods"], "GET");
        assert.equal(res.headers["access-control-allow-credentials"], undefined);
        assert.match(res.headers.vary, /Origin/);
      }
      for (const origin of ["https://evil.example", "https://hwdfarm.com.evil.example",
        "https://unregistered.replit.app", "https://unregistered.replit.dev", "null", "http://roster.hwdfarm.com"]) {
        const res = await request(app).get("/api/suite/menu").set("Origin", origin).expect(403);
        assert.equal(res.headers["access-control-allow-origin"], undefined);
      }
      await request(app).options("/api/suite/menu").set("Origin", "https://forecast.hwdfarm.com")
        .set("Access-Control-Request-Method", "GET").expect(204);
      await request(app).options("/api/suite/menu").set("Origin", "https://forecast.hwdfarm.com")
        .set("Access-Control-Request-Method", "POST").expect(403);
      for (const method of ["post", "put", "delete", "head"] as const) await request(app)[method]("/api/suite/menu").expect(405);
      await request(app).get("/api/suite/menu/not-a-public-route").expect(401);
    });
    await t.test("admin can persist labels/HTTPS hrefs/order; revision increments; menu-edit audited", async () => {
      for (const actor of [member, editor]) {
        await request(app).get("/api/admin/suite-menu").set("Cookie", actor.cookie).expect(403);
        await request(app).put("/api/admin/suite-menu").set("Cookie", actor.cookie).send({}).expect(403);
      }
      await request(app).get("/api/admin/suite-menu").expect(401);
      const menu = (await request(app).get("/api/admin/suite-menu").set("Cookie", admin.cookie).expect(200)).body;
      menu.items[0].label = "Farm home";
      menu.items[2].href = "https://synthetic-scheduler.replit.app";
      [menu.items[0].order, menu.items[1].order] = [1, 0];
      const body = { items: menu.items, tools: menu.tools };
      const result = await request(app).put("/api/admin/suite-menu").set("Cookie", admin.cookie).send(body).expect(200);
      assert.equal(result.body.version, 2);
      assert.equal(result.body.items[0].id, "announcements");
      assert.equal(result.body.items[1].label, "Farm home");
      assert.deepEqual((await request(app).get("/api/suite/menu")).body, result.body);
      await request(app).get("/api/suite/menu").set("Origin", "https://synthetic-scheduler.replit.app").expect(200);
      const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "menu-edit"));
      assert.equal(entry!.actorPersonId, admin.answer.personId);
      for (const bad of ["http://calendar.hwdfarm.com", "https://evil.example", "https://hwdfarm.com.evil.example",
        "javascript:alert(1)", "https://name:pass@roster.hwdfarm.com"]) {
        const invalid = structuredClone(body); invalid.items[0].href = bad;
        const refused = await request(app).put("/api/admin/suite-menu").set("Cookie", admin.cookie).send(invalid).expect(400);
        assert.match(refused.body.error, /HTTPS URL/);
      }
      const duplicate = structuredClone(body); duplicate.items[0].id = duplicate.items[1].id;
      await request(app).put("/api/admin/suite-menu").set("Cookie", admin.cookie).send(duplicate).expect(400);
      assert.equal(isSuiteHref("https://some-app.replit.dev/documents"), true);
    });
    await t.test("tool access uses explicit apps, never role escalation; missing/null legacy apps admin-only", async () => {
      assert.equal(toolAllowed({ role: "admin", apps: [] }, "forecast"), false);
      assert.equal(toolAllowed({ role: "member", apps: ["forecast"] }, "forecast"), true);
      assert.equal(toolAllowed({ role: "editor", apps: ["cap-table"] }, "captable"), true);
      assert.equal(toolAllowed({ role: "member", apps: ["site"] }, "forecast"), false);
      assert.equal(toolAllowed({ role: "admin" }, "captable"), true);
      assert.equal(toolAllowed({ role: "member", apps: null }, "captable"), false);
      const explicitAdmin = await signIn("admin", []);
      const allowedMember = await signIn("member", ["forecast"]);
      const noTools = await request(app).get("/api/apps").set("Cookie", explicitAdmin.cookie).expect(200);
      assert.deepEqual(noTools.body.map((a: { id: string }) => a.id), ["calendar", "roster"]);
      const oneTool = await request(app).get("/api/apps").set("Cookie", allowedMember.cookie).expect(200);
      assert.deepEqual(oneTool.body.map((a: { id: string }) => a.id), ["calendar", "roster", "forecast"]);
      const home = await request(app).get("/api/home").set("Cookie", allowedMember.cookie).expect(200);
      assert(!home.body.apps.some((a: { id: string }) => a.id === "cap-table"));
    });
    await t.test("member Home receives the signed-in notice without access to editor settings", async () => {
      await request(app).put("/api/admin/home-notice").set("Cookie", admin.cookie)
        .send({ text: "Synthetic signed-in family notice", visibility: "signed-in" }).expect(200);
      const home = await request(app).get("/api/home").set("Cookie", member.cookie).expect(200);
      assert.equal(home.body.notice.text, "Synthetic signed-in family notice");
      await request(app).get("/api/admin/home-notice").set("Cookie", member.cookie).expect(403);
      await request(app).get("/api/public/home-notice").expect(204);
    });
    await t.test("SSO stores apps; successful daily recheck refreshes it; outage preserves it", async () => {
      const rawTicket = randomUUID();
      const personId = `synthetic-ticket-${randomUUID()}`;
      tickets.set(rawTicket, { personId, displayName: "Synthetic Ticket Person", goes_by: null,
        email: `${personId}@example.invalid`, rosterAdmin: false, role: "member", apps: ["forecast"],
        authenticated_at: now.toISOString(), grants: [] } as RedeemedIdentity);
      const response = await request(app).get("/auth/sso").query({ ticket: rawTicket, to: "/contact" }).expect(303);
      const cookie = response.headers["set-cookie"][0].split(";")[0];
      const sessionKey = hashToken(cookie.split("=")[1]);
      assert.deepEqual((await request(app).get("/api/auth/session").set("Cookie", cookie)).body.apps, ["forecast"]);
      rosterPeople.set(`${personId}@example.invalid`, { personId, apps: ["captable"] });
      await db.update(sessions).set({ lastRosterCheckAt: new Date(now.getTime() - DAY - 1),
        lastRosterSuccessAt: new Date(now.getTime() - DAY - 1) }).where(eq(sessions.hash, sessionKey));
      const before = rosterCalls;
      const checked = await request(app).get("/api/auth/session").set("Cookie", cookie).expect(200);
      assert.equal(rosterCalls, before + 1);
      assert.deepEqual(checked.body.apps, ["captable"]);
      assert.deepEqual((await db.select().from(sessions).where(eq(sessions.hash, sessionKey)))[0]!.rosterApps, ["captable"]);
      await db.update(sessions).set({ lastRosterCheckAt: new Date(now.getTime() - DAY - 1),
        lastRosterSuccessAt: new Date(now.getTime() - DAY - 1) }).where(eq(sessions.hash, sessionKey));
      const { RosterUnavailableError } = await import("../src/lib/roster");
      const outage = createApp({ ...s, roster: async () => { throw new RosterUnavailableError("Synthetic outage"); } });
      assert.deepEqual((await request(outage).get("/api/auth/session").set("Cookie", cookie).expect(200)).body.apps, ["captable"]);
      rosterPeople.set(`${personId}@example.invalid`, { personId, apps: [] });
      await db.update(sessions).set({ lastRosterCheckAt: new Date(now.getTime() - 3_600_001) })
        .where(eq(sessions.hash, sessionKey));
      assert.deepEqual((await request(app).get("/api/auth/session").set("Cookie", cookie).expect(200)).body.apps, []);
    });
    await t.test("Contact unset is unavailable, recipient private; settings restricted to admin and validated", async () => {
      await request(app).get("/api/contact").expect(401);
      await request(app).post("/api/contact").send({ subject: "x", message: "x" }).expect(401);
      await request(app).get("/api/contact").set("Cookie", member.cookie).expect(200, { configured: false, textAboveForm: DEFAULT_CONTACT_TEXT });
      await request(app).get("/api/admin/contact").set("Cookie", admin.cookie)
        .expect(200, { recipient: "", textAboveForm: DEFAULT_CONTACT_TEXT });
      assert.equal(DEFAULT_CONTACT_TEXT, "Questions, requests, corrections — send them here and the right person will get back to you.");
      await request(app).post("/api/contact").set("Cookie", member.cookie)
        .send({ subject: "Synthetic hello", message: "Synthetic text" }).expect(409, { error: "Contact isn't set up yet" });
      // Existing deployments have recipient-only JSON; no schema/data migration is needed.
      await db.insert(schema.siteSettings).values({ key: "contact", value: { recipient: "contact@example.invalid" },
        updatedBy: admin.answer.personId, updatedAt: new Date("2026-07-01T12:00:00Z") });
      await request(app).get("/api/contact").set("Cookie", member.cookie)
        .expect(200, { configured: true, textAboveForm: DEFAULT_CONTACT_TEXT });
      for (const person of [member, editor]) {
        await request(app).get("/api/admin/contact").set("Cookie", person.cookie).expect(403);
        await request(app).put("/api/admin/contact").set("Cookie", person.cookie).send({ recipient: "nobody@example.invalid" }).expect(403);
      }
      await request(app).put("/api/admin/contact").set("Cookie", admin.cookie).send({ recipient: "invalid" }).expect(400);
      await request(app).put("/api/admin/contact").set("Cookie", admin.cookie)
        .send({ recipient: "contact@example.invalid" }).expect(200, { recipient: "contact@example.invalid", textAboveForm: DEFAULT_CONTACT_TEXT });
      await request(app).get("/api/contact").set("Cookie", member.cookie).expect(200, { configured: true, textAboveForm: DEFAULT_CONTACT_TEXT });
      const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "contact-settings-edit"));
      assert.equal(entry!.actorPersonId, admin.answer.personId);
      assert(!entry!.description.includes("@"));
    });
    await t.test("Contact intro edits persist, are admin-only and audited; limit 300; omitted edits preserve text", async () => {
      const textAboveForm = "Please send your Farm questions here. <b>Plain text only.</b>";
      for (const person of [member, editor]) {
        await request(app).put("/api/admin/contact").set("Cookie", person.cookie)
          .send({ recipient: "contact@example.invalid", textAboveForm }).expect(403);
      }
      await request(app).put("/api/admin/contact").set("Cookie", admin.cookie)
        .send({ recipient: "contact@example.invalid", textAboveForm: "a".repeat(301) }).expect(400);
      await request(app).put("/api/admin/contact").set("Cookie", admin.cookie)
        .send({ recipient: "contact@example.invalid", textAboveForm: "a".repeat(300) }).expect(200);
      await request(app).put("/api/admin/contact").set("Cookie", admin.cookie)
        .send({ recipient: "contact@example.invalid", textAboveForm }).expect(200);
      await request(app).get("/api/contact").set("Cookie", member.cookie).expect(200, { configured: true, textAboveForm });
      await request(app).get("/api/admin/contact").set("Cookie", admin.cookie)
        .expect(200, { recipient: "contact@example.invalid", textAboveForm });
      await request(app).put("/api/admin/contact").set("Cookie", admin.cookie)
        .send({ recipient: "contact@example.invalid" }).expect(200, { recipient: "contact@example.invalid", textAboveForm });
      const entries = await db.select().from(auditLog).where(eq(auditLog.action, "contact-settings-edit"));
      assert.equal(entries.length, 4); // Initial setting, max-length edit, text edit, recipient-only edit.
      assert(entries.every(entry => entry.actorPersonId === admin.answer.personId && !entry.description.includes(textAboveForm)));
    });
    await t.test("Contact validates lengths/headers and refuses cross-site sends", async () => {
      for (const data of [{ subject: "a".repeat(201), message: "ok" }, { subject: "ok", message: "a".repeat(5001) },
        { subject: " \n ", message: "ok" }, { subject: "ok", message: "   " }, { subject: "Injected\r\nBcc: x", message: "ok" }]) {
        await request(app).post("/api/contact").set("Cookie", member.cookie).send(data).expect(400);
      }
      await request(app).post("/api/contact").set("Cookie", member.cookie).set("Origin", "https://evil.example")
        .send({ subject: "ok", message: "ok" }).expect(403);
      assert.equal(delivered.length, 0);
    });
    await t.test("delivery failure does not claim success or consume successful-send quota", async () => {
      failMail = true;
      await request(app).post("/api/contact").set("Cookie", member.cookie)
        .send({ subject: "Synthetic retry", message: "Body never audited" }).expect(503);
      failMail = false;
      assert.equal((await db.select().from(auditLog).where(eq(auditLog.action, "contact-send"))).length, 0);
    });
    await t.test("Contact uses server identity/reply-to and audits subject only; concurrent sixth send refused", async () => {
      await request(app).post("/api/contact").set("Cookie", member.cookie).send({
        subject: "Synthetic subject", message: "PRIVATE SYNTHETIC MESSAGE BODY",
        email: "attacker@example.invalid", name: "Imposter",
      }).expect(200);
      assert.deepEqual(delivered[0], { to: "contact@example.invalid", replyTo: `"Synthetic Suite Person" <${member.answer.email}>`,
        subject: "[HWD Farm contact] Synthetic subject",
        text: `From: Synthetic Suite Person\nEmail: ${member.answer.email}\n\nPRIVATE SYNTHETIC MESSAGE BODY` });
      const statuses = await Promise.all(Array.from({ length: 5 }, (_, i) =>
        request(app).post("/api/contact").set("Cookie", member.cookie)
          .send({ subject: `Synthetic concurrent ${i}`, message: "Synthetic body" }).then(r => r.status)));
      assert.deepEqual(statuses.sort(), [200, 200, 200, 200, 429]);
      const logs = await db.select().from(auditLog).where(eq(auditLog.action, "contact-send"));
      assert.equal(logs.length, 5);
      assert(logs.every(entry => entry.actorPersonId === member.answer.personId && !entry.description.includes("BODY")));
    });
    await t.test("site-wide 20/day limit applies across people; UTC next day permits sending again; clear disables", async () => {
      for (let p = 0; p < 3; p++) {
        const person = await signIn("member", []);
        for (let n = 0; n < 5; n++) await request(app).post("/api/contact").set("Cookie", person.cookie)
          .send({ subject: "Synthetic site quota", message: "Synthetic body" }).expect(200);
      }
      const fresh = await signIn("member", []);
      await request(app).post("/api/contact").set("Cookie", fresh.cookie)
        .send({ subject: "Synthetic twenty-first", message: "Synthetic body" }).expect(429);
      assert.equal(delivered.length, 20);
      now = new Date(now.getTime() + DAY);
      await request(app).post("/api/contact").set("Cookie", fresh.cookie)
        .send({ subject: "Synthetic next day", message: "Synthetic body" }).expect(200);
      assert.equal(delivered.length, 21);
      await request(app).put("/api/admin/contact").set("Cookie", admin.cookie).send({ recipient: "" }).expect(200);
      const disabled = await request(app).get("/api/contact").set("Cookie", member.cookie).expect(200);
      assert.equal(disabled.body.configured, false);
      assert.equal(typeof disabled.body.textAboveForm, "string");
      await request(app).post("/api/contact").set("Cookie", fresh.cookie)
        .send({ subject: "Synthetic disabled", message: "Synthetic body" }).expect(409);
    });
    await t.test("development Contact transport logs instead of contacting Resend", async () => {
      const original = globalThis.fetch;
      globalThis.fetch = async () => { throw new Error("Development must never access Resend"); };
      try {
        await sendContactMail({ to: "contact@example.invalid", replyTo: "nobody@example.invalid",
          subject: "[HWD Farm contact] Synthetic dev only", text: "Synthetic body" });
      } finally { globalThis.fetch = original; }
    });
  } finally {
    await isolatedPool.end();
    await control.query("RESET search_path");
    await control.query(`DROP SCHEMA "${isolated}" CASCADE`);
    control.release();
    await pool.end();
  }
});
