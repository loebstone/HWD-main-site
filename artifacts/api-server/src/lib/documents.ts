import { CreateLinkDocumentBody } from "@workspace/api-zod";
import type { documents } from "@workspace/db";
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
