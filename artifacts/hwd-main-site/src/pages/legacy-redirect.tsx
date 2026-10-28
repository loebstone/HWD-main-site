import { useEffect } from "react";
import { useLocation } from "wouter";
import { useListDocumentGroups, getListDocumentGroupsQueryKey } from "@workspace/api-client-react";
import { ListSkeleton } from "@/components/states";

/** Client fallback for old section URLs; the server normally answers these with a 301. */
export function LegacyRedirect({ groupId }: { groupId?: string }) {
  const [, setLocation] = useLocation();
  const q = useListDocumentGroups({ query: { enabled: !!groupId, queryKey: getListDocumentGroupsQueryKey() } });
  useEffect(() => {
    if (!groupId) { setLocation("/documents", { replace: true }); return; }
    if (q.isLoading) return;
    const groups = q.data ?? [];
    const hit = groups.find(g => g.id === groupId);
    setLocation(hit ? `/documents/${hit.slug}` : "/documents", { replace: true });
  }, [groupId, q.isLoading, q.data, setLocation]);
  return <ListSkeleton rows={3} />;
}

export const MeetingsRedirect = () => <LegacyRedirect />;
export const ShareholdersRedirect = () => <LegacyRedirect groupId="10000000-0000-4000-8000-000000000001" />;
export const DirectorsRedirect = () => <LegacyRedirect groupId="10000000-0000-4000-8000-000000000002" />;
export const LoggingRedirect = () => <LegacyRedirect groupId="10000000-0000-4000-8000-000000000004" />;
export const GoverningRedirect = () => <LegacyRedirect groupId="10000000-0000-4000-8000-000000000003" />;
export const PhotoArchiveRedirect = () => <LegacyRedirect groupId="10000000-0000-4000-8000-000000000005" />;
