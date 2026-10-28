import { Router } from "express";
import multer from "multer";
import { pipeline } from "node:stream/promises";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { documents } from "@workspace/db";
import { documentMetadata, insertNewDocument, publicDocument, validPdf } from "../lib/documents";
import { audit } from "../lib/audit";
import { requireEditor, visitorAddress } from "../middlewares/security";
import type { Services } from "../lib/services";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 1, fieldSize: 32_768 } }).single("file");
const idOf = (id: unknown) => z.string().uuid().parse(id);
export function documentRoutes(s: Services) {
  const router = Router();
  router.get("/", async (req, res): Promise<void> => {
    const section = z.enum(["shareholders", "directors", "governing", "logging", "photo_archive"]).optional().parse(req.query.section);
    const includeRetired = req.query.includeRetired === "true";
    if (includeRetired && req.siteIdentity!.role === "member") { res.status(403).json({ error: "Editor access required" }); return; }
    const rows = await s.db.select().from(documents).where(and(
      section ? eq(documents.section, section) : undefined, includeRetired ? undefined : isNull(documents.retiredAt)))
      .orderBy(desc(documents.year), asc(documents.sortOrder), asc(documents.title));
    res.json(rows.map(publicDocument));
  });
  router.get("/:id/open", async (req, res): Promise<void> => {
    const id = idOf(req.params.id);
    const [doc] = await s.db.select().from(documents).where(and(eq(documents.id, id), isNull(documents.retiredAt)));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (doc.type === "link") {
      await audit(s.db, req.siteIdentity!, "document-open", doc.id, "Opened external document link", visitorAddress(req));
      res.redirect(302, doc.externalUrl!); return;
    }
    const stream = await s.storage.read(doc.storageKey!);
    await audit(s.db, req.siteIdentity!, "document-open", doc.id, "Opened private PDF", visitorAddress(req));
    res.setHeader("Content-Type", "application/pdf");
    const safeName = doc.title.replace(/[^\w .-]/g, "_").slice(0, 160);
    res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
    // A PDF viewer may require blob: internally; scripts remain prohibited in this response.
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'; sandbox");
    try { await pipeline(stream, res); } catch { if (!res.headersSent) res.status(503).end(); else res.destroy(); }
  });
  router.use(requireEditor);
  router.post("/", async (req, res): Promise<void> => {
    const meta = documentMetadata(req.body);
    if (meta.type !== "link") { res.status(400).json({ error: "Use PDF upload for file documents" }); return; }
    const row = await s.db.transaction(tx => insertNewDocument(s, tx, req.siteIdentity!, visitorAddress(req), meta));
    res.status(201).json(publicDocument(row));
  });
  router.post("/upload", upload, async (req, res): Promise<void> => {
    const meta = documentMetadata(JSON.parse(req.body.metadata ?? "{}"));
    if (meta.type !== "pdf" || !req.file || !validPdf(req.file.buffer)) {
      res.status(400).json({ error: "Upload a valid PDF, up to 50 MB" }); return;
    }
    const row = await s.db.transaction(tx => insertNewDocument(s, tx, req.siteIdentity!, visitorAddress(req), meta, req.file!.buffer));
    res.status(201).json(publicDocument(row));
  });
  router.patch("/:id", async (req, res): Promise<void> => {
    const id = idOf(req.params.id);
    const meta = documentMetadata(req.body);
    const updated = await s.db.transaction(async tx => {
      const [current] = await tx.select().from(documents).where(and(eq(documents.id, id), isNull(documents.retiredAt))).for("update");
      if (!current) return null;
      if (meta.type !== current.type) throw new Error("Use replace to change document type");
      const [row] = await tx.update(documents).set(meta).where(eq(documents.id, id)).returning();
      await audit(tx, req.siteIdentity!, "document-edit", id, "Edited document metadata", visitorAddress(req));
      return row!;
    });
    if (!updated) { res.status(404).json({ error: "Document not found" }); return; }
    res.json(publicDocument(updated));
  });
  router.post("/:id/replace", upload, async (req, res): Promise<void> => {
    const id = idOf(req.params.id);
    const meta = documentMetadata(JSON.parse(req.body.metadata ?? "{}"));
    if (meta.type === "pdf" && (!req.file || !validPdf(req.file.buffer))) {
      res.status(400).json({ error: "Upload a valid replacement PDF, up to 50 MB" }); return;
    }
    // Do not upload bytes for missing/retired records.
    const [existing] = await s.db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, id), isNull(documents.retiredAt)));
    if (!existing) { res.status(404).json({ error: "Document not found" }); return; }
    const key = meta.type === "pdf" ? await s.storage.save(req.file!.buffer) : null;
    const row = await s.db.transaction(async tx => {
      const [old] = await tx.select().from(documents).where(and(eq(documents.id, id), isNull(documents.retiredAt))).for("update");
      if (!old) return null;
      await tx.update(documents).set({ retiredAt: s.now() }).where(eq(documents.id, id));
      const [doc] = await tx.insert(documents).values({ ...meta, storageKey: key, replaces: id,
        uploadedBy: req.siteIdentity!.personId, uploadedByName: req.siteIdentity!.displayName }).returning();
      await audit(tx, req.siteIdentity!, "document-replace", doc!.id, `Replaced document ${id}; prior version retained`, visitorAddress(req));
      return doc!;
    });
    if (!row) { res.status(409).json({ error: "Document has already been replaced or retired" }); return; }
    res.status(201).json(publicDocument(row));
  });
  router.post("/:id/retire", async (req, res): Promise<void> => {
    const id = idOf(req.params.id);
    const retired = await s.db.transaction(async tx => {
      const [doc] = await tx.update(documents).set({ retiredAt: s.now() })
        .where(and(eq(documents.id, id), isNull(documents.retiredAt))).returning();
      if (!doc) return false;
      await audit(tx, req.siteIdentity!, "document-retire", id, "Retired document; record and file retained", visitorAddress(req));
      return true;
    });
    if (!retired) { res.status(404).json({ error: "Document not found" }); return; }
    res.json({ message: "Document retired" });
  });
  return router;
}
