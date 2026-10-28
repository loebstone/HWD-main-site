import { useEffect, useState, type ReactNode } from "react";
import { getRosterEntry } from "@workspace/api-client-react";
import { redirectToSignIn } from "@/lib/sign-in-navigation";
import { useSession, errorStatus } from "@/lib/session";
import { Button } from "@/components/ui/button";

export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const [redirectFailed, setRedirectFailed] = useState(false);
  const status = errorStatus(session.error);
  const anonymous = status === 401;

  useEffect(() => {
    if (anonymous) {
      void redirectToSignIn(window.location, getRosterEntry, url => window.location.replace(url))
        .catch(() => setRedirectFailed(true));
    }
  }, [anonymous]);

  if (session.isLoading || (anonymous && !redirectFailed)) return null;
  if (session.isError || !session.data) {
    return (
      <div className="min-h-[100dvh] grid place-items-center px-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-3xl">We couldn't reach the Farm</h1>
          <p className="text-muted-foreground">Something went wrong checking your session. Give it another try in a moment.</p>
          <Button onClick={() => window.location.reload()} data-testid="button-retry-session">Try again</Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
