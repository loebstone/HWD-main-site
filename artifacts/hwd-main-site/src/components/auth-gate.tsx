import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useSession, errorStatus } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const [, setLocation] = useLocation();
  const status = errorStatus(session.error);
  const anonymous = status === 401;

  useEffect(() => {
    if (anonymous) setLocation(`/sign-in?to=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`, { replace: true });
  }, [anonymous, setLocation]);

  if (session.isLoading || anonymous) {
    return (
      <div className="min-h-[100dvh] px-6 py-10 max-w-5xl mx-auto space-y-6" data-testid="status-session-loading">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    );
  }
  if (session.isError || !session.data) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-3xl">We couldn't reach the Farm</h1>
          <p className="text-muted-foreground">Something went wrong checking your session. Give it another try in a moment.</p>
          <Button onClick={() => session.refetch()} data-testid="button-retry-session">Try again</Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
