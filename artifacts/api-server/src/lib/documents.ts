import { CreateLinkDocumentBody } from "@workspace/api-zod";
import { documents, type db, type SiteIdentity } from "@workspace/db";
import { audit } from "./audit";
import type { Services } from "./services";

// Manual uploads and the old-site importer share validation, private storage, creation and audit.
export async function insertNewDocument(s: Services, writer: Pick<typeof db, "insert">,
  actor: SiteIdentity, address: string, input: unknown, bytes?: Buffer, legacySheetId?: string) {
  const meta = documentMetadata(input);
  if (meta.type === "pdf" && (!bytes || !validPdf(bytes))) throw new Error("Invalid PDF signature or file over 50 MB");
  const storageKey = meta.type === "pdf" ? await s.storage.save(bytes!) : null;
  const [doc] = await writer.insert(documents).values({ ...meta, storageKey, legacySheetId,
    uploadedBy: actor.personId, uploadedByName: actor.displayName, uploadedAt: s.now() }).returning();
  await audit(writer, actor, "document-upload", doc!.id,
    meta.type === "pdf" ? "Uploaded private PDF" : "Added external document link", address);
  return doc!;
}
export function documentMetadata(value: unknown) {
  const data = CreateLinkDocumentBody.parse(value);
  data.title = data.title.trim();
  if (!data.title) throw new Error("Invalid document metadata");
  if (["shareholders", "directors"].includes(data.section) && data.year == null) throw new Error("Year is required");
  if (data.type === "link") {
    if (!data.externalUrl) throw new Error("External URL is required");
    const url = new URL(data.externalUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid external URL");
    data.externalUrl = url.href;
  } else data.externalUrl = null;
  return { ...data, year: data.year ?? null, externalUrl: data.externalUrl ?? null };
}
export function validPdf(buffer: Buffer): boolean {
  return buffer.length <= 50 * 1024 * 1024 &&
    /^%PDF-(?:1\.[0-7]|2\.0)/.test(buffer.subarray(0, 8).toString("ascii")) &&
    buffer.subarray(-1024).includes(Buffer.from("%%EOF"));
}
export function publicDocument(row: typeof documents.$inferSelect) {
  const { storageKey: _privateKey, ...safe } = row;
  return safe;
}
