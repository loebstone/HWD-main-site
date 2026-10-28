import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useVerifySignIn, useGetVerificationGate, getGetSessionQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { AuthFrame } from "@/components/auth-frame";

export default function AuthContinuePage() {
  const search = useSearch();
  const token = useMemo(() => new URLSearchParams(search).get("token") ?? "", [search]);
  const valid = /^[a-f0-9]{64}$/.test(token);
  const verify = useVerifySignIn();
  const gate = useGetVerificationGate({ query: { retry: false, staleTime: Infinity } });
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [failed, setFailed] = useState(!valid);

  async function go() {
    try {
      const identity = await verify.mutateAsync({ data: { token } });
      qc.clear();
      qc.setQueryData(getGetSessionQueryKey(), identity);
      setLocation("/", { replace: true });
    } catch { setFailed(true); }
  }

  return (
    <AuthFrame>
      {failed ? (
        <div className="space-y-4" data-testid="status-verify-failed">
          <h1 className="text-3xl md:text-4xl">This link can't be used</h1>
          <p className="text-muted-foreground text-lg">It may have expired or already been used. Ask for a new link and use the newest email.</p>
          <Link href="/sign-in" className="inline-flex h-12 items-center rounded-md bg-primary px-6 text-primary-foreground" data-testid="link-request-new">
            Request a new link
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <h1 className="text-3xl md:text-4xl">Almost in</h1>
          <p className="text-muted-foreground text-lg">Press continue to sign in on this device.</p>
          {gate.isError && <p role="alert">Too many attempts or sign-in is unavailable. Please wait and try again.</p>}
          <Button size="lg" className="w-full h-12 text-base" onClick={go} disabled={verify.isPending || !gate.isSuccess} data-testid="button-continue">
            {verify.isPending ? "Signing in..." : "Continue"}
          </Button>
        </div>
      )}
    </AuthFrame>
  );
}
