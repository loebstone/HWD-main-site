import { validPdf } from "./documents";

export const OLD_SITE_INDEX = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTj9hReulNzY8HXduXLsnB88VylYR1NkqRQbAjLKq1V0o1m0cgyfOAOc7c14sCURrt4hLq5UrNFZBFX/pub?output=csv";
export const PDF_LIMIT = 50 * 1024 * 1024;

export function googleUrl(input: string | URL): URL {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
    !["google.com", "googleusercontent.com"].some(domain => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error("Refused a non-Google fetch or redirect");
  }
  return url;
}

// Manual redirects are intentional: fetch's automatic redirects can escape the host allowlist.
export async function fetchGoogle(input: string | URL, limit: number, fetcher: typeof fetch = fetch) {
  let url = googleUrl(input);
  for (let redirects = 0; redirects <= 6; redirects++) {
    const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(20_000),
      cache: "no-store", headers: { "Cache-Control": "no-cache" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Google redirect had no destination");
      url = googleUrl(new URL(location, url));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Google returned HTTP ${response.status}`);
    }
    if (Number(response.headers.get("content-length") ?? 0) > limit) {
      await response.body?.cancel();
      throw new Error(`Response exceeds ${limit === PDF_LIMIT ? "50 MB" : "index size limit"}`);
    }
    if (!response.body) throw new Error("Google returned an empty response");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw new Error("Response exceeds size limit (PDF maximum 50 MB)"); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return { bytes: Buffer.concat(chunks), url };
  }
  throw new Error("Too many Google redirects");
}

function htmlText(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    });
}
const attribute = (tag: string, name: string) => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? htmlText(match[1] ?? match[2] ?? match[3] ?? "") : undefined;
};

export function googleConfirmLink(html: string, base: URL): URL | null {
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attribute(tag, "href");
    if (!href) continue;
    const candidate = new URL(href, base);
    if (candidate.searchParams.has("confirm")) return googleUrl(candidate);
  }
  for (const form of html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) ?? []) {
    if ((attribute(form.split(">")[0]!, "method") ?? "get").toLowerCase() !== "get") continue;
    const action = attribute(form.split(">")[0]!, "action");
    if (!action) continue;
    const url = new URL(action, base);
    for (const input of form.match(/<input\b[^>]*>/gi) ?? []) {
      const name = attribute(input, "name"), value = attribute(input, "value");
      if (name && value !== undefined) url.searchParams.set(name, value);
    }
    if (url.searchParams.has("confirm")) return googleUrl(url);
  }
  return null;
}

export async function fetchOldSitePdf(url: string, allowConfirm: boolean, fetcher: typeof fetch = fetch): Promise<Buffer> {
  let response = await fetchGoogle(url, PDF_LIMIT, fetcher);
  if (!response.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) && allowConfirm) {
    const confirm = googleConfirmLink(response.bytes.toString("utf8"), response.url);
    if (confirm) response = await fetchGoogle(confirm, PDF_LIMIT, fetcher); // exactly one confirmation
  }
  if (!validPdf(response.bytes)) throw new Error("Google did not return a signature-validated PDF (or PDF is incomplete)");
  return response.bytes;
}

export type SheetRow = Record<string, string>;
// RFC 4180 quoting, embedded newlines, escaped quotes and a BOM; no dependency on a cached CSV.
export function parseOldSiteCsv(source: string): SheetRow[] {
  const records: string[][] = [];
  let record: string[] = [], field = "", quoted = false, closed = false;
  const text = source.replace(/^\uFEFF/, "");
  const endField = () => { record.push(field); field = ""; closed = false; };
  const endRecord = () => { endField(); if (record.some(cell => cell.trim())) records.push(record); record = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ",") endField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
    } else {
      if (closed && c.trim()) throw new Error("Invalid CSV quoting");
      if (!closed) field += c;
    }
  }
  if (quoted) throw new Error("Unterminated CSV quoted field");
  if (field || record.length || closed) endRecord();
  const headers = records.shift()?.map(cell => cell.trim().toLowerCase());
  if (!headers) throw new Error("The published index was empty");
  if (!headers[0]) headers[0] = "id";
  // The current published sheet has a blank twelfth header but contains supporting_text there.
  if (headers.length === 12 && !headers[11]) headers[11] = "supporting_text";
  for (const name of ["id", "title", "section", "year", "type", "embed_url", "open_url", "sort_order", "tags"]) {
    if (!headers.includes(name)) throw new Error(`Index column missing: ${name}`);
  }
  const named = headers.filter(Boolean);
  if (new Set(named).size !== named.length) throw new Error("Duplicate CSV column names");
  if (records.length > 1_000) throw new Error("Index exceeds 1,000 rows; import refused");
  return records.map(cells => {
    if (cells.length > headers.length) throw new Error("CSV row has more cells than its header");
    return Object.fromEntries(headers.filter(Boolean).map(name => [name, (cells[headers.indexOf(name)] ?? "").trim()]));
  });
}
