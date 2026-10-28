export const DAY = 86_400_000;
export const neutralMessage = "If that address is on the Farm roster, a link is on its way";
export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is unset; feature refused`);
  return value;
}
export function appOrigin(): string {
  let origin = process.env.APP_ORIGIN?.trim();
  if (!origin && process.env.NODE_ENV !== "production") {
    const domain = process.env.REPLIT_DEV_DOMAIN;
    if (domain) origin = `https://${domain}`;
  }
  if (!origin) throw new Error("APP_ORIGIN is unset; sign-in refused");
  const url = new URL(origin);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
      !["http:", "https:"].includes(url.protocol) ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new Error("APP_ORIGIN must be a valid origin; sign-in refused");
  }
  return url.origin;
}
