import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetHomeGroups, useListDocumentGroups, useUpdateHomeGroups } from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, Check, Lock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/session";
import { invalidateDocs } from "@/lib/invalidate";
import { cn } from "@/lib/utils";

const MAX = 4;

export function AdminHomePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const groups = useListDocumentGroups();
  const home = useGetHomeGroups();
  const save = useUpdateHomeGroups();
  const [picked, setPicked] = useState<string[]>([]);
  const inited = useRef(false);

  useEffect(() => {
    if (home.data && !inited.current) { inited.current = true; setPicked(home.data.groupIds); }
  }, [home.data]);

  const byId = new Map((groups.data ?? []).map((g) => [g.id, g]));
  const live = picked.filter((id) => byId.has(id));
  const dirty = JSON.stringify(live) !== JSON.stringify((home.data?.groupIds ?? []).filter((id) => byId.has(id)));

  function toggle(id: string) {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id]);
  }
  function shift(i: number, d: -1 | 1) {
    setPicked(() => { const n = [...live]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  }
  async function submit() {
    try {
      await save.mutateAsync({ data: { groupIds: live } });
      inited.current = false;
      await invalidateDocs(qc);
      toast({ title: "Home page updated", description: live.length ? `${live.length} quick access ${live.length === 1 ? "card" : "cards"}` : "Quick access cards hidden" });
    } catch (err) {
      toast({ title: "Couldn't save", description: errorMessage(err, "Please try again."), variant: "destructive" });
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Home" intro={`Pick up to ${MAX} document groups to feature as quick access cards on the family home page.`} />
      <AdminTabs />
      {groups.isLoading || home.isLoading ? <ListSkeleton rows={4} /> :
        groups.isError || home.isError ? <ErrorState onRetry={() => { void groups.refetch(); void home.refetch(); }} /> :
        <div className="grid lg:grid-cols-[1fr_20rem] gap-6 items-start">
          <section className="rounded-2xl border bg-card p-4 md:p-6">
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h2 className="text-2xl leading-snug">Groups</h2>
              <span className="text-sm text-muted-foreground tabular-nums" data-testid="text-picked-count">{live.length} of {MAX} chosen</span>
            </div>
            {!groups.data?.length ? <p className="text-muted-foreground">There are no groups yet. Create some under Documents.</p> :
              <ul className="space-y-2">
                {groups.data.map((g) => {
                  const on = live.includes(g.id);
                  const full = !on && live.length >= MAX;
                  return <li key={g.id}>
                    <button type="button" onClick={() => toggle(g.id)} disabled={full} aria-pressed={on}
                      className={cn("w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                        on ? "border-primary/50 bg-secondary/60" : "bg-background/40 hover:border-primary/30", full && "opacity-45 cursor-not-allowed")}
                      data-testid={`button-pick-group-${g.id}`}>
                      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors", on ? "bg-primary border-primary text-primary-foreground" : "bg-card")}>
                        {on && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium break-words">{g.name}</span>
                        <span className="block text-sm text-muted-foreground">{g.documentCount} documents{g.visibility === "staff" && <> · <Lock className="inline h-3 w-3" /> staff only</>}</span>
                      </span>
                    </button>
                  </li>;
                })}
              </ul>}
          </section>
          <aside className="rounded-2xl border bg-card p-4 md:p-6 lg:sticky lg:top-32">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Order on home</p>
            {!live.length ? <p className="mt-3 text-muted-foreground" data-testid="text-no-picks">None chosen. The quick access cards won't show.</p> :
              <ol className="mt-3 space-y-2">
                {live.map((id, i) => <li key={id} className="flex items-center gap-2 rounded-lg border bg-background/40 px-3 py-2" data-testid={`row-picked-${id}`}>
                  <span className="w-5 text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{byId.get(id)?.name}</span>
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => shift(i, -1)} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" data-testid={`button-picked-up-${id}`}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" aria-label="Move down" disabled={i === live.length - 1} onClick={() => shift(i, 1)} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30" data-testid={`button-picked-down-${id}`}><ArrowDown className="h-4 w-4" /></button>
                </li>)}
              </ol>}
            <Button className="mt-5 w-full" onClick={submit} disabled={!dirty || save.isPending} data-testid="button-save-home-groups">{save.isPending ? "Saving…" : dirty ? "Save home page" : "Saved"}</Button>
          </aside>
        </div>}
    </div>
  );
}
