import assert from "node:assert/strict";
import { test } from "node:test";
import { createConnection } from "node:net";
import request from "supertest";
import { createApp } from "../src/app";
import { canonicalOriginGateway } from "../src/middlewares/canonical-origin";
import { rosterEntry } from "../src/lib/sso";

test("canonical host: production-only guard on API and HTML gateway (no database access)", async t => {
  assert.notEqual(process.env.NODE_ENV, "production", "Run only in development");
  const saved = { NODE_ENV: process.env.NODE_ENV, APP_ORIGIN: process.env.APP_ORIGIN, ROSTER_BASE_URL: process.env.ROSTER_BASE_URL };
  try {
    // Simulated production request policy, not a production connection.
    process.env.NODE_ENV = "production";
    process.env.APP_ORIGIN = "https://hwdfarm.com";
    for (const [name, factory] of [["API", createApp], ["HTML gateway", canonicalOriginGateway]] as const) {
      const app = factory();
      // The API already ends unknown non-API paths with 404; the standalone
      // HTML gateway instead passes through to its downstream test marker.
      const untouched = name === "API" ? 404 : 200;
      app.get("/canonical-probe", (_req, res) => { res.cookie("test", "downstream"); res.send("untouched"); });
      if (name === "HTML gateway") app.get("/api/healthz", (_req, res) => { res.json({ status: "ok" }); });
      await t.test(`${name}: www and old Replit GET/HEAD redirect 301 with exact path/query, before cookies`, async () => {
        for (const host of ["www.hwdfarm.com", "hwd-main-site.replit.app"]) {
          const res = await request(app).get("/documents?search=a%2Fb&year=2026").set("Host", host).expect(301);
          assert.equal(res.headers.location, "https://hwdfarm.com/documents?search=a%2Fb&year=2026");
          assert.equal(res.headers["set-cookie"], undefined);
          await request(app).get("/documents").set("Host", host).expect(301).expect("Location", "https://hwdfarm.com/documents");
          const head = await request(app).head("/canonical-probe?x=1").set("Host", host).expect(301);
          assert.equal(head.headers.location, "https://hwdfarm.com/canonical-probe?x=1");
          assert.equal(head.text, undefined);
          const cookie = await request(app).get("/canonical-probe").set("Host", host).expect(301);
          assert.equal(cookie.headers["set-cookie"], undefined);
        }
      });
      await t.test(`${name}: alias writes return short 403 without redirect or cookie`, async () => {
        for (const method of ["post", "put", "patch", "delete", "options"] as const) {
          const res = await request(app)[method]("/api/auth/link").set("Host", "www.hwdfarm.com")
            .set("Origin", "https://hwdfarm.com").set("Content-Type", "application/json").send("{").expect(403);
          assert.deepEqual(res.body, { error: "Write requests require same-origin browser headers" });
          assert.equal(res.headers.location, undefined);
          assert.equal(res.headers["set-cookie"], undefined);
        }
      });
      await t.test(`${name}: health answers 200 on aliases; canonical host and missing Host are untouched`, async () => {
        for (const host of ["www.hwdfarm.com", "hwd-main-site.replit.app"]) {
          const health = await request(app).get("/api/healthz?probe=1").set("Host", host).expect(200);
          assert.equal(health.body.status, "ok");
          assert.equal(health.headers.location, undefined);
        }
        for (const host of ["hwdfarm.com", "HWDFARM.COM"]) {
          const canonical = await request(app).get("/canonical-probe").set("Host", host).expect(untouched);
          assert.equal(canonical.headers.location, undefined);
        }
        // Superagent inserts Host automatically. HTTP/1.0 exercises the actual
        // no-Host exception without Node's HTTP/1.1 Host-required rejection.
        const server = app.listen(0, "127.0.0.1");
        await new Promise<void>(resolve => server.once("listening", resolve));
        try {
          const address = server.address(); assert(address && typeof address !== "string");
          const raw = await new Promise<string>((resolve, reject) => {
            const socket = createConnection(address.port, "127.0.0.1");
            let data = "";
            socket.on("connect", () => socket.write("GET /canonical-probe HTTP/1.0\r\nConnection: close\r\n\r\n"));
            socket.on("data", chunk => { data += chunk; });
            socket.on("end", () => resolve(data));
            socket.on("error", reject);
          });
          assert.equal(Number(raw.match(/^HTTP\/1\.[01] (\d+)/)?.[1]), untouched);
          assert.doesNotMatch(raw.split("\r\n\r\n")[0]!, /\r\nLocation:/i);
        } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
      });
      await t.test(`${name}: uses existing bounded proxy trust; redirect cannot escape canonical host`, async () => {
        app.set("trust proxy", 1);
        await request(app).get("/documents?x=%2F").set("Host", "internal.example.invalid")
          .set("X-Forwarded-Host", "www.hwdfarm.com").expect(301).expect("Location", "https://hwdfarm.com/documents?x=%2F");
        await request(app).get("/canonical-probe").set("Host", "internal.example.invalid")
          .set("X-Forwarded-Host", "hwdfarm.com").expect(untouched);
        app.set("trust proxy", 0);
        await request(app).get("/documents").set("Host", "www.hwdfarm.com")
          .set("X-Forwarded-Host", "hwdfarm.com").expect(301);
        await request(app).get("//evil.example/path?x=1").set("Host", "www.hwdfarm.com")
          .expect(301).expect("Location", "https://hwdfarm.com//evil.example/path?x=1");
      });
    }
    await t.test("development ignores alias Host even when APP_ORIGIN is unset", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.APP_ORIGIN;
      for (const [index, app] of [createApp(), canonicalOriginGateway()].entries()) {
        app.get("/canonical-probe", (_req, res) => { res.send("development"); });
        await request(app).get("/canonical-probe").set("Host", "www.hwdfarm.com").expect(index === 0 ? 404 : 200);
        app.post("/canonical-probe", (_req, res) => { res.send("development write"); });
        await request(app).post("/canonical-probe").set("Host", "www.hwdfarm.com").expect(index === 0 ? 404 : 200);
      }
    });
    await t.test("SSO entry still uses APP_ORIGIN; no Roster registry change", () => {
      process.env.NODE_ENV = "production";
      process.env.APP_ORIGIN = "https://hwdfarm.com";
      process.env.ROSTER_BASE_URL = "https://roster.example.invalid";
      const entry = new URL(rosterEntry("/documents"));
      assert.equal(entry.searchParams.get("origin"), "https://hwdfarm.com");
      assert.equal(entry.searchParams.get("to"), "/documents");
      assert.equal(entry.searchParams.get("app"), "site");
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
