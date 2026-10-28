import { z } from "zod";
import { required } from "./config";
const rosterResponse = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(false) }),
  z.object({
    allowed: z.literal(true), personId: z.union([z.string().min(1), z.number().int()]).transform(String),
    displayName: z.string().min(1), goes_by: z.string().nullable(),
    apps: z.array(z.string().min(1).max(100)).max(100).optional(),
    grants: z.unknown().optional(),
  }),
]);
export type RosterAnswer = z.infer<typeof rosterResponse>;
export class RosterUnavailableError extends Error {}
export class RosterUnexpectedResponseError extends Error {}
const redeemedIdentity = z.object({
  personId: z.union([z.string().min(1), z.number().int()]).transform(String),
  displayName: z.string().min(1), goes_by: z.string().nullable(),
  email: z.string().email(), rosterAdmin: z.boolean(),
  role: z.enum(["member", "editor", "admin"]),
  authenticated_at: z.string().datetime({ offset: true }),
  apps: z.array(z.string().min(1).max(100)).max(100).optional(),
  grants: z.unknown().optional(),
});
export type RedeemedIdentity = z.infer<typeof redeemedIdentity>;
export async function redeemRosterTicket(ticket: string): Promise<RedeemedIdentity | null> {
  const base = required("ROSTER_BASE_URL");
  const key = required("SITE_SERVICE_KEY");
  const url = new URL(`${base.replace(/\/$/, "")}/api/service/sso-redeem`);
  if (!["http:", "https:"].includes(url.protocol) ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new Error("ROSTER_BASE_URL is invalid; sign-in refused");
  }
  const response = await fetch(url, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  if (response.status === 401) return null;
  if (response.status !== 200) throw new RosterUnexpectedResponseError("Roster ticket redemption refused");
  return redeemedIdentity.parse(await response.json());
}
export async function checkRoster(email: string, timeoutMs = 10_000): Promise<RosterAnswer> {
  const base = required("ROSTER_BASE_URL");
  const key = required("SITE_SERVICE_KEY");
  const url = new URL(`${base.replace(/\/$/, "")}/api/service/sign-in-check`);
  if (!["http:", "https:"].includes(url.protocol) || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new Error("ROSTER_BASE_URL is invalid; sign-in refused");
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) {
      throw new RosterUnavailableError("Roster request timed out or was unreachable");
    }
    throw error;
  }
  if (response.status >= 500 || response.status === 408 || response.status === 429) {
    throw new RosterUnavailableError(`Roster service returned ${response.status}`);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new RosterUnexpectedResponseError("Roster redirects are refused");
  }
  if (!response.ok) throw new RosterUnexpectedResponseError(`Roster returned unexpected status ${response.status}`);
  const parsed = rosterResponse.safeParse(await response.json());
  if (!parsed.success) throw new RosterUnexpectedResponseError("Roster returned an unexpected response");
  return parsed.data;
}
