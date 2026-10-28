import { Link } from "wouter";
import { useListDocumentGroups } from "@workspace/api-client-react";
import { ArrowRight, Lock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/docs";

export default function DocumentsPage() {
  const q = useListDocumentGroups();
  return (
    <>
      <PageHeader eyebrow="Records" title="Documents" intro="Everything the family keeps on file, sorted into groups." />
      {q.isLoading ? (
        <div className="grid md:grid-cols-2 gap-4" data-testid="status-loading">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : q.isError ? <ErrorState onRetry={() => q.refetch()} /> :
        !q.data?.length ? <EmptyState title="No groups yet">When an editor sets up document groups, they'll be listed here.</EmptyState> :
        <div className="grid md:grid-cols-2 gap-4">
          {q.data.map((g, i) => (
            <Link key={g.id} href={`/documents/${g.slug}`} style={{ animationDelay: `${i * 50}ms` }}
              className="rise group flex flex-col min-w-0 rounded-2xl border bg-card p-5 md:p-6 hover:shadow-lg hover:border-primary/40 transition-all"
              data-testid={`link-group-${g.slug}`}>
              <span className="flex items-start justify-between gap-3">
                <span className="font-display text-2xl leading-snug break-words min-w-0">{g.name}</span>
                <span className="shrink-0 mt-1 rounded-full bg-secondary px-2.5 py-0.5 text-sm text-primary tabular-nums" data-testid={`text-group-count-${g.slug}`}>
                  {g.documentCount}
                </span>
              </span>
              {g.visibility === "staff" && <span className="mt-1 inline-flex items-center gap-1 text-xs uppercase tracking-[0.16em] text-muted-foreground"><Lock className="h-3 w-3" />Staff only</span>}
              {g.description && <span className="mt-2 block text-muted-foreground break-words">{g.description}</span>}
              <span className="mt-auto pt-5 flex items-end justify-between gap-3 text-sm">
                <span className="min-w-0 text-muted-foreground">
                  {g.latestTitle ? <>
                    <span className="block text-xs uppercase tracking-[0.16em]">Latest</span>
                    <span className="block truncate text-foreground/85" data-testid={`text-group-latest-${g.slug}`}>{g.latestTitle}</span>
                    {g.latestDate && <span className="block">{formatDate(g.latestDate)}</span>}
                  </> : "Nothing added yet"}
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>}
    </>
  );
}
