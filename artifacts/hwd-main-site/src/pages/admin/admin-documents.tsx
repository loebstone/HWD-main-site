import { useMemo, useState } from "react";
import { useListDocuments, type Document } from "@workspace/api-client-react";
import { FileUp, Link2, Pencil, Replace, Archive, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { DocumentFormDialog, type FormMode } from "@/components/admin/document-form-dialog";
import { RetireDialog } from "@/components/admin/retire-dialog";
import { OldSiteImportPanel } from "@/components/admin/old-site-import";
import { useSession } from "@/lib/session";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SECTION_LABELS, formatDate, matches, openUrl, sortDocs } from "@/lib/docs";

export default function AdminDocumentsPage() {
  const { data: me } = useSession();
  const [includeRetired, setIncludeRetired] = useState(false);
  const q = useListDocuments({ includeRetired });
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{ mode: FormMode; doc?: Document } | null>(null);
  const [retiring, setRetiring] = useState<Document | null>(null);

  const docs = useMemo(() => sortDocs((q.data ?? []).filter((d) => matches(d, search))), [q.data, search]);

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
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="pl-9 h-11 bg-card" data-testid="input-admin-search" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="retired" checked={includeRetired} onCheckedChange={setIncludeRetired} data-testid="switch-include-retired" />
          <Label htmlFor="retired">Show retired</Label>
        </div>
      </div>

      {q.isLoading ? <ListSkeleton rows={5} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> :
        docs.length === 0 ? <EmptyState title={search ? "No matches" : "No documents yet"}>{search ? "Try a different word." : "Upload a PDF or add a link to get started."}</EmptyState> :
        <ul className="divide-y rounded-2xl border bg-card">
          {docs.map((d) => (
            <li key={d.id} className={"p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-3 " + (d.retiredAt ? "opacity-60" : "")} data-testid={`row-document-${d.id}`}>
              <div className="min-w-0 flex-1">
                <a href={openUrl(d.id)} target="_blank" rel="noopener noreferrer" className="font-display text-lg hover:text-primary" data-testid={`link-admin-open-${d.id}`}>{d.title}</a>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span className="text-foreground/80">{SECTION_LABELS[d.section]}</span>
                  {d.year != null && <span>{d.year}</span>}
                  <span>{d.type === "pdf" ? "PDF" : "Link"}</span>
                  <span>Order {d.sortOrder}</span>
                  <span>Added by {d.uploadedByName} on {formatDate(d.uploadedAt)}</span>
                  {d.replaces && <span>Replaces an earlier version</span>}
                  {d.retiredAt && <span className="text-destructive">Retired {formatDate(d.retiredAt)}</span>}
                </div>
              </div>
              {!d.retiredAt && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setForm({ mode: "edit", doc: d })} data-testid={`button-edit-${d.id}`}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => setForm({ mode: "replace", doc: d })} data-testid={`button-replace-${d.id}`}><Replace className="h-3.5 w-3.5 mr-1" />Replace</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRetiring(d)} data-testid={`button-retire-${d.id}`}><Archive className="h-3.5 w-3.5 mr-1" />Retire</Button>
                </div>
              )}
            </li>
          ))}
        </ul>}

      <DocumentFormDialog mode={form?.mode ?? "upload"} doc={form?.doc} open={!!form} onOpenChange={(o) => !o && setForm(null)} />
      <RetireDialog doc={retiring} onClose={() => setRetiring(null)} />
    </>
  );
}
