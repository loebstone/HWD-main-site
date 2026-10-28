import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useGetDocumentGroup, getGetDocumentGroupQueryKey, type Document } from "@workspace/api-client-react";
import { ArrowLeft, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { DocumentCard } from "@/components/document-card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { errorStatus } from "@/lib/session";
import { groupByYear, matches, sortList } from "@/lib/docs";

export default function DocumentGroupPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";
  const q = useGetDocumentGroup(slug, {
    query: { queryKey: getGetDocumentGroupQueryKey(slug), enabled: !!slug, retry: (n, err) => errorStatus(err) !== 404 && errorStatus(err) !== 403 && n < 2 },
  });
  const [search, setSearch] = useState("");
  const filtered = useMemo<Document[]>(() => (q.data?.documents ?? []).filter((d) => matches(d, search)), [q.data, search]);
  const byYear = q.data?.group.layout === "by_year";
  const years = useMemo(() => (byYear ? groupByYear(filtered) : []), [byYear, filtered]);
  const list = useMemo(() => (byYear ? [] : sortList(filtered)), [byYear, filtered]);

  const back = <Link href="/documents" className="inline-flex items-center gap-1.5 mb-5 text-sm text-primary hover:underline underline-offset-4" data-testid="link-back-documents"><ArrowLeft className="h-4 w-4" />All documents</Link>;

  if (q.isLoading) return <>{back}<div className="mb-8 space-y-3"><div className="h-9 w-2/3 rounded-md bg-muted animate-pulse" /></div><ListSkeleton /></>;
  if (q.isError) {
    const s = errorStatus(q.error);
    return <>{back}{s === 404 || s === 403
      ? <EmptyState title="We couldn't find that group">It may have been renamed or retired. <Link href="/documents" className="text-primary underline underline-offset-4">See all documents</Link>.</EmptyState>
      : <ErrorState onRetry={() => q.refetch()} />}</>;
  }
  if (!q.data) return null;
  const { group, documents } = q.data;

  return (
    <>
      {back}
      <PageHeader eyebrow="Documents" title={group.name} intro={group.description || undefined} />
      <div className="space-y-6">
        {documents.length > 0 && <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={byYear ? "Search titles, notes, tags, years" : "Search titles, notes, tags"} className="pl-9 h-11 bg-card text-base" data-testid="input-search" />
        </div>}
        {documents.length === 0 ? <EmptyState title="Nothing here yet">When an editor adds documents to this group, they'll appear here.</EmptyState> :
          filtered.length === 0 ? <EmptyState title="No matches">Try a different word{byYear ? " or a year" : ""}.</EmptyState> :
          byYear ? <div className="space-y-10">
            {years.map((g) => (
              <section key={g.year ?? "undated"} className="rise">
                <h2 className="rule-ornament text-sm uppercase tracking-[0.2em] mb-4" data-testid={`text-year-${g.year ?? "undated"}`}>
                  <span className="font-display normal-case tracking-normal text-2xl text-foreground">{g.year ?? "Undated"}</span>
                </h2>
                <div className="space-y-4">{g.docs.map((d) => <DocumentCard key={d.id} doc={d} />)}</div>
              </section>
            ))}
          </div> :
          <div className="rise space-y-4">{list.map((d) => <DocumentCard key={d.id} doc={d} />)}</div>}
      </div>
    </>
  );
}
