import { appOrigin, required } from "./config";

// Also reject browser URL normalization tricks (backslashes, encoded separators,
// whitespace/control characters). Never reflect unvalidated input into Location.
export function returnPath(value: unknown): string {
  if (value === undefined) return "/";
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") ||
      /[\\\s\u0000-\u001f\u007f]/.test(value) || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f|25)/i.test(value)) {
    throw new Error("Invalid return path");
  }
  const parsed = new URL(value, "https://site.invalid");
  if (parsed.origin !== "https://site.invalid") throw new Error("Invalid return path");
  return value;
}

export function rosterEntry(to: unknown): string {
  const base = new URL(required("ROSTER_BASE_URL"));
  if (!["https:", "http:"].includes(base.protocol) ||
      (process.env.NODE_ENV === "production" && base.protocol !== "https:") ||
      base.username || base.password) throw new Error("ROSTER_BASE_URL is invalid; sign-in refused");
  const url = new URL("/sign-in", base);
  url.search = new URLSearchParams({ app: "site", to: returnPath(to), origin: appOrigin() }).toString();
  return url.href;
}

export function rosterSignOut(): string {
  return new URL("/sign-out", rosterEntry("/")).href;
}
