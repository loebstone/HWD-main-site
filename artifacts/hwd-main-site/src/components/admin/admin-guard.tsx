import type { ReactNode } from "react";
import { Link } from "wouter";
import { useSession, canEdit } from "@/lib/session";
import { EmptyState } from "@/components/states";

export function AdminGuard({ children }: { children: ReactNode }) {
  const { data: me } = useSession();
  if (!canEdit(me)) {
    return (
      <EmptyState title="This area is for editors">
        Your role doesn't include editing. <Link href="/" className="text-primary underline">Back home</Link>
      </EmptyState>
    );
  }
  return <>{children}</>;
}

export function AdminOnlyGuard({ children }: { children: ReactNode }) {
  const { data: me } = useSession();
  if (me?.role !== "admin") {
    return <EmptyState title="This area is for administrators">Your role doesn't include administration access. <Link href="/" className="text-primary underline">Back home</Link></EmptyState>;
  }
  return <>{children}</>;
}
