import { z } from "zod";
import { required } from "./config";
const rosterResponse = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(false) }),
  z.object({
    allowed: z.literal(true), personId: z.union([z.string().min(1), z.number().int()]).transform(String),
    displayName: z.string().min(1), goes_by: z.string().nullable(),
  }),
]);
export type RosterAnswer = z.infer<typeof rosterResponse>;
export async function checkRoster(email: string): Promise<RosterAnswer> {
  const base = required("ROSTER_BASE_URL");
  const key = required("SITE_SERVICE_KEY");
  const url = new URL(`${base.replace(/\/$/, "")}/api/service/sign-in-check`);
  if (!["http:", "https:"].includes(url.protocol) || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new Error("ROSTER_BASE_URL is invalid; sign-in refused");
  }
  const response = await fetch(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error("Roster unavailable; sign-in refused");
  return rosterResponse.parse(await response.json());
}
