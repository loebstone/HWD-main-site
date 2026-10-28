import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDocumentGroups, useCreateDocumentGroup, useUpdateDocumentGroup, useRetireDocumentGroup,
  type DocumentGroup, type GroupInput,
} from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, Archive, FolderPlus, Lock, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/session";
import { invalidateDocs } from "@/lib/invalidate";

function toInput(g: DocumentGroup, sortOrder = g.sortOrder): GroupInput {
  return { name: g.name, slug: g.slug, description: g.description, sortOrder, layout: g.layout, visibility: g.visibility };
}

function GroupFormDialog({ group, open, nextOrder, onOpenChange }: { group?: DocumentGroup; open: boolean; nextOrder: number; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateDocumentGroup();
  const update = useUpdateDocumentGroup();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [layout, setLayout] = useState<GroupInput["layout"]>("list");
  const [visibility, setVisibility] = useState<GroupInput["visibility"]>("everyone");
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(group?.name ?? ""); setSlug(group?.slug ?? ""); setDescription(group?.description ?? "");
    setSortOrder(String(group?.sortOrder ?? nextOrder)); setLayout(group?.layout ?? "list"); setVisibility(group?.visibility ?? "everyone");
  }, [open, group, nextOrder]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) { setError("Give the group a name."); return; }
    if (n.length > 150) { setError("Name is too long (150 characters max)."); return; }
    const s = slug.trim();
    if (s && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) { setError("Web name can use lowercase letters, numbers and dashes only."); return; }
    if (description.length > 500) { setError("Description is too long (500 characters max)."); return; }
    const so = Number(sortOrder || 0);
    if (!Number.isInteger(so)) { setError("Sort order should be a whole number."); return; }
    const data: GroupInput = { name: n, description: description.trim(), sortOrder: so, layout, visibility, ...(s ? { slug: s } : {}) };
    setError(null);
    try {
      if (group) await update.mutateAsync({ id: group.id, data });
      else await create.mutateAsync({ data });
      await invalidateDocs(qc);
      toast({ title: group ? "Group saved" : "Group created", description: n });
      onOpenChange(false);
    } catch (err) { setError(errorMessage(err, "Saving failed. Please try again.")); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{group ? "Edit group" : "New group"}</DialogTitle>
          <DialogDescription>Groups are how documents are arranged on the Documents page.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="g-name">Name</Label><Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-group-name" /></div>
          <div className="space-y-1.5"><Label htmlFor="g-slug">Web name (optional)</Label>
            <Input id="g-slug" value={slug} placeholder="Made from the name if left blank" onChange={(e) => setSlug(e.target.value.toLowerCase())} data-testid="input-group-slug" />
            <p className="text-sm text-muted-foreground break-all">/documents/{slug.trim() || "…"}</p></div>
          <div className="space-y-1.5"><Label htmlFor="g-desc">Description</Label><Textarea id="g-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-group-description" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label>Arrange by</Label>
              <Select value={layout} onValueChange={(v) => { if (v === "list" || v === "by_year") setLayout(v); }}>
                <SelectTrigger data-testid="select-group-layout"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="by_year">Year, newest first</SelectItem><SelectItem value="list">A simple list</SelectItem></SelectContent>
              </Select></div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1"><Label>Who can see it</Label>
              <Select value={visibility} onValueChange={(v) => { if (v === "everyone" || v === "staff") setVisibility(v); }}>
                <SelectTrigger data-testid="select-group-visibility"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="everyone">All members</SelectItem><SelectItem value="staff">Editors and admins only</SelectItem></SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label htmlFor="g-sort">Sort order</Label><Input id="g-sort" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} data-testid="input-group-sort" /></div>
          </div>
          {error && <p className="text-sm text-destructive" data-testid="text-group-error">{error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} data-testid="button-save-group">{busy ? "Saving..." : "Save group"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GroupsPanel() {
  const q = useListDocumentGroups();
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateDocumentGroup();
  const retire = useRetireDocumentGroup();
  const [form, setForm] = useState<{ group?: DocumentGroup } | null>(null);
  const [retiring, setRetiring] = useState<DocumentGroup | null>(null);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const groups = q.data ?? [];

  async function move(i: number, dir: -1 | 1) {
    const a = groups[i], b = groups[i + dir];
    if (!a || !b) return;
    setMoving(a.id);
    // Renumber the whole list so swaps work even when orders tie.
    const order = groups.map((g) => g.id);
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    try {
      for (let k = 0; k < order.length; k++) {
        const g = groups.find((x) => x.id === order[k])!;
        const so = (k + 1) * 10;
        if (g.sortOrder !== so) await update.mutateAsync({ id: g.id, data: toInput(g, so) });
      }
    } catch (err) {
      toast({ title: "Couldn't reorder", description: errorMessage(err, "Please try again."), variant: "destructive" });
    } finally { await invalidateDocs(qc); setMoving(null); }
  }

  async function confirmRetire() {
    if (!retiring) return;
    setRetireError(null);
    try {
      await retire.mutateAsync({ id: retiring.id });
      await invalidateDocs(qc);
      toast({ title: "Group retired", description: retiring.name });
      setRetiring(null);
    } catch (err) { setRetireError(errorMessage(err, "Couldn't retire it. Move its documents elsewhere first.")); }
  }

  return (
    <section className="mb-9 rounded-2xl border bg-card p-4 md:p-6" data-testid="panel-groups">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Arrangement</p><h2 className="mt-1 text-2xl leading-snug">Groups</h2></div>
        <Button size="sm" variant="outline" onClick={() => setForm({})} data-testid="button-new-group"><FolderPlus className="h-4 w-4 mr-1.5" />New group</Button>
      </div>
      {q.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div> :
        q.isError ? <ErrorState onRetry={() => q.refetch()} /> :
        !groups.length ? <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">No groups yet. Create one to start filing documents.</p> :
        <ul className="divide-y rounded-xl border bg-background/40">
          {groups.map((g, i) => (
            <li key={g.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-3 md:px-4" data-testid={`row-group-${g.id}`}>
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex flex-col">
                  <button type="button" aria-label="Move up" disabled={i === 0 || !!moving} onClick={() => move(i, -1)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors" data-testid={`button-group-up-${g.id}`}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" aria-label="Move down" disabled={i === groups.length - 1 || !!moving} onClick={() => move(i, 1)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors" data-testid={`button-group-down-${g.id}`}><ArrowDown className="h-4 w-4" /></button>
                </div>
                <div className={"min-w-0 transition-opacity " + (moving === g.id ? "opacity-50" : "")}>
                  <p className="font-display text-lg leading-snug break-words">{g.name}</p>
                  <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                    <span className="break-all">/{g.slug}</span>
                    <span>{g.layout === "by_year" ? "By year" : "List"}</span>
                    <span>{g.documentCount} {g.documentCount === 1 ? "document" : "documents"}</span>
                    {g.visibility === "staff" && <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />Staff only</span>}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pl-9 sm:pl-0">
                <Button size="sm" variant="outline" onClick={() => setForm({ group: g })} data-testid={`button-edit-group-${g.id}`}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setRetireError(null); setRetiring(g); }} data-testid={`button-retire-group-${g.id}`}><Archive className="h-3.5 w-3.5 mr-1" />Retire</Button>
              </div>
            </li>
          ))}
        </ul>}

      <GroupFormDialog open={!!form} group={form?.group} nextOrder={((groups[groups.length - 1]?.sortOrder ?? 0) + 10)} onOpenChange={(o) => !o && setForm(null)} />
      <AlertDialog open={!!retiring} onOpenChange={(o) => { if (!o && !retire.isPending) setRetiring(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">Retire this group?</AlertDialogTitle>
            <AlertDialogDescription>
              "{retiring?.name}" will disappear from the Documents page. A group can only be retired once it's empty{retiring && retiring.documentCount > 0 ? ` — it still holds ${retiring.documentCount}` : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {retireError && <p className="text-sm text-destructive" data-testid="text-retire-group-error">{retireError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retire.isPending}>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmRetire} disabled={retire.isPending} data-testid="button-confirm-retire-group">{retire.isPending ? "Retiring..." : "Retire"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
