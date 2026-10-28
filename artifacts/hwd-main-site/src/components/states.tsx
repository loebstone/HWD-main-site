import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" data-testid="status-loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-[72px] w-full rounded-xl" />)}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6" data-testid="status-error">
      <p className="font-display text-xl">That didn't load.</p>
      <p className="text-muted-foreground mt-1">{message ?? "The server didn't answer cleanly. Try again in a moment."}</p>
      <Button variant="outline" className="mt-4" onClick={onRetry} data-testid="button-retry">Try again</Button>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card/60 px-6 py-12 text-center" data-testid="status-empty">
      <svg viewBox="0 0 120 40" className="mx-auto mb-4 h-10 w-28 text-primary/40" aria-hidden>
        <path d="M0 34 Q20 14 40 26 T80 20 T120 28" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M0 38 Q30 26 60 32 T120 34" fill="none" stroke="currentColor" strokeWidth="1" opacity=".6" />
      </svg>
      <p className="font-display text-2xl">{title}</p>
      {children && <div className="mt-2 text-muted-foreground max-w-md mx-auto">{children}</div>}
    </div>
  );
}
