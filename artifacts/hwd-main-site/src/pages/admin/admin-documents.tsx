import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListDocuments, useListDocumentGroups, useMoveDocuments, type Document } from "@workspace/api-client-react";
import { FileUp, Link2, Pencil, Replace, Archive, Search, FolderInput, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { DocumentFormDialog, type FormMode } from "@/components/admin/document-form-dialog";
import { RetireDialog } from "@/components/admin/retire-dialog";
import { OldSiteImportPanel } from "@/components/admin/old-site-import";
import { GroupsPanel } from "@/components/admin/groups-panel";
import { useSession, errorMessage } from "@/lib/session";
import { invalidateDocs } from "@/lib/invalidate";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, matches, openUrl, sortDocs } from "@/lib/docs";

const ALL = "__all";

export default function AdminDocumentsPage() {
  const { data: me } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [includeRetired, setIncludeRetired] = useState(false);
  const q = useListDocuments({ includeRetired });
  const groupsQ = useListDocumentGroups();
  const moveDocs = useMoveDocuments();
  const [search, setSearch] = useState("");
  const [filterGroup, setFilterGroup] = useState(ALL);
  const [form, setForm] = useState<{ mode: FormMode; doc?: Document } | null>(null);
  const [retiring, setRetiring] = useState<Document | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");

  const groupName = useMemo(() => new Map((groupsQ.data ?? []).map((g) => [g.id, g.name])), [groupsQ.data]);
  const docs = useMemo(() => sortDocs((q.data ?? []).filter((d) => matches(d, search) && (filterGroup === ALL || d.groupId === filterGroup))), [q.data, search, filterGroup]);
  const selectable = docs.filter((d) => !d.retiredAt);
  const allSelected = selectable.length > 0 && selectable.every((d) => selected.has(d.id));

  function toggle(id: string, on: boolean) {
    setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  }

  async function doMove() {
    if (!target || !selected.size) return;
    const ids = [...selected];
    try {
      await moveDocs.mutateAsync({ data: { ids, groupId: target } });
      await invalidateDocs(qc);
      toast({ title: `Moved ${ids.length} ${ids.length === 1 ? "document" : "documents"}`, description: groupName.get(target) });
      setSelected(new Set()); setTarget("");
    } catch (err) {
      toast({ title: "Couldn't move them", description: errorMessage(err, "Please try again."), variant: "destructive" });
    }
  }

  const defaultGroupId = filterGroup !== ALL ? filterGroup : undefined;

  return (
    <>
      <PageHeader eyebrow="Admin" title="Documents">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setForm({ mode: "upload" })} data-testid="button-upload-pdf"><FileUp className="h-4 w-4 mr-1.5" />Upload PDF</Button>
          <Button variant="outline" onClick={() => setForm({ mode: "link" })} data-testid="button-add-link"><Link2 className="h-4 w-4 mr-1.5" />Add link</Button>
        </div>
      </PageHeader>
      <AdminTabs />
      {me?.role === "admin" && <OldSiteImportPanel />}
      <GroupsPanel />

      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 mb-4">
        <div className="relative flex-1 md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="pl-9 h-11 bg-card" data-testid="input-admin-search" />
        </div>
        <Select value={filterGroup} onValueChange={setFilterGroup}>
          <SelectTrigger className="h-11 bg-card md:w-60" data-testid="select-filter-group"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All groups</SelectItem>
            {(groupsQ.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="retired" checked={includeRetired} onCheckedChange={setIncludeRetired} data-testid="switch-include-retired" />
          <Label htmlFor="retired">Show retired</Label>
        </div>
      </div>

      {selectable.length > 0 && (
        <div className={"sticky top-[4.25rem] lg:top-[6.75rem] z-20 mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors " + (selected.size ? "bg-secondary/90 backdrop-blur border-primary/30" : "bg-card/80")} data-testid="bar-move">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v ? new Set(selectable.map((d) => d.id)) : new Set())} data-testid="checkbox-select-all" />
            {selected.size ? <span data-testid="text-selected-count">{selected.size} selected</span> : <span className="text-muted-foreground">Select to move</span>}
          </label>
          {selected.size > 0 && <>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="h-9 w-full sm:w-56 bg-card" data-testid="select-move-target"><SelectValue placeholder="Move to group…" /></SelectTrigger>
              <SelectContent>{(groupsQ.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" onClick={doMove} disabled={!target || moveDocs.isPending} data-testid="button-move-documents"><FolderInput className="h-4 w-4 mr-1.5" />{moveDocs.isPending ? "Moving..." : "Move"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} data-testid="button-clear-selection"><X className="h-4 w-4 mr-1" />Clear</Button>
          </>}
        </div>
      )}

      {q.isLoading ? <ListSkeleton rows={5} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> :
        docs.length === 0 ? <EmptyState title={search || filterGroup !== ALL ? "No matches" : "No documents yet"}>{search || filterGroup !== ALL ? "Try a different word or group." : "Upload a PDF or add a link to get started."}</EmptyState> :
        <ul className="divide-y rounded-2xl border bg-card">
          {docs.map((d) => (
            <li key={d.id} className={"p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-3 transition-colors " + (d.retiredAt ? "opacity-60 " : "") + (selected.has(d.id) ? "bg-secondary/40" : "")} data-testid={`row-document-${d.id}`}>
              <div className="flex items-start gap-3 min-w-0 flex-1">
                {!d.retiredAt ? <Checkbox className="mt-1.5" checked={selected.has(d.id)} onCheckedChange={(v) => toggle(d.id, !!v)} aria-label={`Select ${d.title}`} data-testid={`checkbox-document-${d.id}`} /> : <span className="w-4 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <a href={openUrl(d.id)} target="_blank" rel="noopener noreferrer" className="font-display text-lg hover:text-primary break-words" data-testid={`link-admin-open-${d.id}`}>{d.title}</a>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="text-foreground/80" data-testid={`text-document-group-${d.id}`}>{groupName.get(d.groupId) ?? (d.retiredAt ? "Retired group" : "Unknown group")}</span>
                    {d.year != null && <span>{d.year}</span>}
                    <span>{d.type === "pdf" ? "PDF" : "Link"}</span>
                    <span>Order {d.sortOrder}</span>
                    <span>Added by {d.uploadedByName} on {formatDate(d.uploadedAt)}</span>
                    {d.replaces && <span>Replaces an earlier version</span>}
                    {d.retiredAt && <span className="text-destructive">Retired {formatDate(d.retiredAt)}</span>}
                  </div>
                </div>
              </div>
              {!d.retiredAt && (
                <div className="flex flex-wrap gap-2 pl-7 md:pl-0">
                  <Button size="sm" variant="outline" onClick={() => setForm({ mode: "edit", doc: d })} data-testid={`button-edit-${d.id}`}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => setForm({ mode: "replace", doc: d })} data-testid={`button-replace-${d.id}`}><Replace className="h-3.5 w-3.5 mr-1" />Replace</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRetiring(d)} data-testid={`button-retire-${d.id}`}><Archive className="h-3.5 w-3.5 mr-1" />Retire</Button>
                </div>
              )}
            </li>
          ))}
        </ul>}

      <DocumentFormDialog mode={form?.mode ?? "upload"} doc={form?.doc} defaultGroupId={defaultGroupId} open={!!form} onOpenChange={(o) => !o && setForm(null)} />
      <RetireDialog doc={retiring} onClose={() => setRetiring(null)} />
    </>
  );
}
