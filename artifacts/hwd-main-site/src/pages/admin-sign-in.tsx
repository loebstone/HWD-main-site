import { MagicLinkForm } from "./sign-in";
import { AuthFrame } from "@/components/auth-frame";

export default function AdminSignInPage() {
  return <AuthFrame>
    <p className="mb-5 text-muted-foreground">For administrators when the Roster is unavailable.</p>
    <MagicLinkForm />
  </AuthFrame>;
}
