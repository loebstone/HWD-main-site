import { useMemo, useState } from "react";
import { useListDocuments, type Section } from "@workspace/api-client-react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DocumentCard } from "@/components/document-card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { groupByYear, matches } from "@/lib/docs";

export function DocumentLibrary({ section, emptyText }: { section: Section; emptyText: string }) {
  const q = useListDocuments({ section });
  const [search, setSearch] = useState("");
  const groups = useMemo(() => groupByYear((q.data ?? []).filter((d) => matches(d, search))), [q.data, search]);

  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search titles, notes, tags, years" className="pl-9 h-11 bg-card text-base" data-testid="input-search" />
      </div>
      {q.isLoading ? <ListSkeleton /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> :
        (q.data ?? []).length === 0 ? <EmptyState title="Nothing here yet">{emptyText}</EmptyState> :
        groups.length === 0 ? <EmptyState title="No matches">Nothing matches "{search}". Try a shorter word or a year.</EmptyState> :
        <div className="space-y-10">
          {groups.map((g) => (
            <section key={g.year ?? "undated"} className="rise">
              <h2 className="rule-ornament text-sm uppercase tracking-[0.2em] mb-4" data-testid={`text-year-${g.year ?? "undated"}`}>
                <span className="font-display normal-case tracking-normal text-2xl text-foreground">{g.year ?? "Undated"}</span>
              </h2>
              <div className="space-y-4">{g.docs.map((d) => <DocumentCard key={d.id} doc={d} />)}</div>
            </section>
          ))}
        </div>}
    </div>
  );
}
