import { ReplitConnectors } from "@replit/connectors-sdk";
import { required } from "./config";
import { logger } from "./logger";
export async function sendSignInLink(email: string, link: string): Promise<void> {
  const from = required("MAIL_FROM");
  if (process.env.NODE_ENV !== "production") {
    // Deliberate development-only delivery. Never return this link to an HTTP client.
    logger.info({ developmentSignInLink: link }, "Development email only — no email sent");
    return;
  }
  const response = await new ReplitConnectors().proxy("resend", "/emails", {
    method: "POST",
    body: JSON.stringify({ from, to: [email], subject: "Your HWD Farm sign-in link",
      text: `Sign in to HWD Farm: ${link}\nThis link expires in 15 minutes. Open it, then choose Continue. If you did not request it, ignore this email.` }),
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Resend delivery failed; sign-in refused");
}
