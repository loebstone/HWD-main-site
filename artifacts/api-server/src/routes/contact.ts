import { Router } from "express";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { SendContactBody, UpdateContactSettingsBody } from "@workspace/api-zod";
import { siteSettings, auditLog } from "@workspace/db";
import { requireAdmin, visitorAddress } from "../middlewares/security";
import { audit } from "../lib/audit";
import type { Services } from "../lib/services";

export const DEFAULT_CONTACT_TEXT = "Questions, requests, corrections — send them here and the right person will get back to you.";
const contactSettings = z.object({
  recipient: z.union([z.literal(""), z.string().trim().email().max(320)]),
  textAboveForm: z.string().max(300).default(DEFAULT_CONTACT_TEXT),
});
const contactInput = z.object({
  subject: z.string().trim().min(1).max(200).refine(value => !/[\r\n\u0000]/.test(value), "Use a single-line subject"),
  message: z.string().trim().min(1).max(5000),
});
async function settings(s: Services) {
  const [row] = await s.db.select().from(siteSettings).where(eq(siteSettings.key, "contact"));
  return contactSettings.parse(row ? row.value : { recipient: "" });
}
async function recipient(s: Services) {
  return (await settings(s)).recipient;
}
export function contactRoutes(s: Services) {
  const router = Router();
  router.get("/", async (_req, res) => {
    const value = await settings(s);
    res.json({ configured: Boolean(value.recipient), textAboveForm: value.textAboveForm });
  });
  router.post("/", async (req, res): Promise<void> => {
    const parsed = contactInput.safeParse(SendContactBody.parse(req.body));
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map(i => i.message).join("; ") }); return; }
    const actor = req.siteIdentity!;
    const result = await s.db.transaction(async tx => {
      // This lock is shared by ALL senders, across processes. Twenty per UTC day
      // means serializing this small mail path is preferable to racy counters.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(74202003)`);
      const to = await recipient({ ...s, db: tx as unknown as Services["db"] });
      if (!to) return 409;
      const now = s.now();
      const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
      const today = and(eq(auditLog.action, "contact-send"), gte(auditLog.at, start), lt(auditLog.at, end));
      const [all] = await tx.select({ n: count() }).from(auditLog).where(today);
      const [person] = await tx.select({ n: count() }).from(auditLog)
        .where(and(today, eq(auditLog.actorPersonId, actor.personId)));
      if (Number(all!.n) >= 20 || Number(person!.n) >= 5) return 429;
      const replyName = JSON.stringify(actor.displayName.replace(/[\u0000-\u001f\u007f]/g, " "));
      await s.contactEmail({ to, replyTo: `${replyName} <${req.siteSession!.email}>`,
        subject: `[HWD Farm contact] ${parsed.data.subject}`,
        text: `From: ${actor.displayName}\nEmail: ${req.siteSession!.email}\n\n${parsed.data.message}` });
      await audit(tx, actor, "contact-send", null, parsed.data.subject, visitorAddress(req), now);
      return 200;
    });
    if (result === 409) { res.status(409).json({ error: "Contact isn't set up yet" }); return; }
    if (result === 429) { res.status(429).json({ error: "The daily Contact limit has been reached. Please try again tomorrow." }); return; }
    res.json({ message: process.env.NODE_ENV === "production" ? "Your message has been sent." : "Your message was logged in development; no email was sent." });
  });
  return router;
}

export function adminContactRoutes(s: Services) {
  const router = Router();
  router.use(requireAdmin);
  router.get("/", async (_req, res) => { res.json(await settings(s)); });
  router.put("/", async (req, res): Promise<void> => {
    const input = UpdateContactSettingsBody.parse(req.body);
    const parsed = contactSettings.safeParse({ recipient: input.recipient.trim(), textAboveForm: input.textAboveForm });
    if (!parsed.success) { res.status(400).json({ error: "Enter a valid recipient email, or leave it blank to disable Contact." }); return; }
    const saved = await s.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(74202003)`);
      const current = await settings({ ...s, db: tx as unknown as Services["db"] });
      const value = { ...parsed.data, textAboveForm: input.textAboveForm ?? current.textAboveForm };
      await tx.insert(siteSettings).values({ key: "contact", value,
        updatedBy: req.siteIdentity!.personId, updatedAt: s.now() })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value,
          updatedBy: req.siteIdentity!.personId, updatedAt: s.now() } });
      await audit(tx, req.siteIdentity!, "contact-settings-edit", "contact", "Updated Contact settings", visitorAddress(req));
      return value;
    });
    res.json(saved);
  });
  return router;
}
