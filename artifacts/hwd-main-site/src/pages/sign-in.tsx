import { useState } from "react";
import { useGetPublicHomeNotice, useRequestSignIn } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AuthFrame } from "@/components/auth-frame";
import { NoticeText } from "@/components/notice-text";

export const NEUTRAL = "If that address is on the Farm roster, a link is on its way";

export default function SignInPage() {
  const request = useRequestSignIn();
  const publicNotice = useGetPublicHomeNotice();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!v) return;
    setBusy(true);
    try { await request.mutateAsync({ data: { email: v } }); } catch { /* neutral regardless */ }
    setBusy(false);
    setSent(true);
  }

  return (
    <AuthFrame>
      {publicNotice.data?.text && <aside className="mb-7 rounded-lg border-l-4 border-primary bg-accent/50 px-4 py-3" data-testid="notice-public">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">From HWD Farm</p>
        <p className="mt-1"><NoticeText text={publicNotice.data.text} /></p>
      </aside>}
      {sent ? (
        <div className="space-y-4" data-testid="status-link-sent">
          <h1 className="text-3xl md:text-4xl">Check your email</h1>
          <p className="text-lg">{NEUTRAL}</p>
          <p className="text-muted-foreground">The link works once and expires before long. You can close this tab.</p>
          <button className="text-primary underline underline-offset-4" onClick={() => { setSent(false); setEmail(""); }} data-testid="button-try-another">
            Use a different address
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div>
            <h1 className="text-3xl md:text-4xl">Welcome back</h1>
            <p className="mt-2 text-muted-foreground text-lg">Enter your email and we'll send you a link to come in. No password to remember.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input id="email" type="email" autoComplete="email" required maxLength={320} value={email}
              onChange={(e) => setEmail(e.target.value)} className="h-12 text-base bg-card" data-testid="input-email" />
          </div>
          <Button type="submit" size="lg" className="w-full h-12 text-base" disabled={busy} data-testid="button-request-link">
            {busy ? "Sending..." : "Send me a link"}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
