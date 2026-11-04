import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetHomeDisplayQueryKey, getGetHomeQueryKey, useGetHomeDisplay, useUpdateHomeDisplay, useCheckFamilyTime, useListDocuments, type HomeDisplay } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/session";

export function AdminHomePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const display = useGetHomeDisplay();
  const documents = useListDocuments({ includeRetired: false }, { query: { staleTime: 0, refetchOnMount: "always" } });
  const save = useUpdateHomeDisplay();
  const familyTime = useCheckFamilyTime({ query: { enabled: false, retry: false, gcTime: 0 } });
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<NonNullable<HomeDisplay["featuredLineMode"]>>("automatic");
  const [documentId, setDocumentId] = useState("");
  const [label, setLabel] = useState("Featured:");
  const saved = useRef<string | null>(null);
  const values = { slideshowEmbedUrl: url.trim() || null, featuredLineMode: mode, featuredDocumentId: documentId || null, featuredLabel: label.trim() };
  const snapshot = JSON.stringify(values);
  const dirty = saved.current !== null && snapshot !== saved.current;
  const selectedAvailable = (documents.data ?? []).some(doc => doc.id === documentId);
  const invalid = (!!url.trim() && !/^https:\/\//i.test(url.trim())) || (mode === "chosen" && (!documentId || !selectedAvailable));

  function apply(value: HomeDisplay) {
    const next = { slideshowEmbedUrl: value.slideshowEmbedUrl ?? null, featuredLineMode: value.featuredLineMode ?? "automatic",
      featuredDocumentId: value.featuredDocumentId ?? null, featuredLabel: value.featuredLabel ?? "Featured:" };
    saved.current = JSON.stringify(next);
    setUrl(next.slideshowEmbedUrl ?? "");
    setMode(next.featuredLineMode);
    setDocumentId(next.featuredDocumentId ?? "");
    setLabel(next.featuredLabel);
  }

  useEffect(() => {
    if (!display.data) return;
    if (saved.current !== null && snapshot !== saved.current) return;
    apply(display.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.data]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  async function submit() {
    try {
      const res = await save.mutateAsync({ data: values });
      apply(res);
      qc.setQueryData(getGetHomeDisplayQueryKey(), res);
      await Promise.all([qc.invalidateQueries({ queryKey: getGetHomeDisplayQueryKey() }), qc.invalidateQueries({ queryKey: getGetHomeQueryKey() })]);
      toast({ title: "Home page updated", description: "Featured line and slideshow settings saved." });
    } catch (err) {
      toast({ title: "Couldn't save", description: errorMessage(err, "Please check the link and try again."), variant: "destructive" });
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Home" intro="Choose the featured line above announcements and the slideshow below them." />
      <AdminTabs />
      {display.isLoading ? <ListSkeleton rows={2} /> : display.isError ? <ErrorState onRetry={() => display.refetch()} /> :
        <section className="max-w-2xl rounded-2xl border bg-card p-5 md:p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="featured-line-mode">Featured line</Label>
            <select id="featured-line-mode" value={mode} onChange={(e) => setMode(e.target.value as NonNullable<HomeDisplay["featuredLineMode"]>)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base" data-testid="select-featured-line-mode">
              <option value="automatic">Automatic — latest minutes</option>
              <option value="chosen">Chosen document</option>
              <option value="none">None</option>
            </select>
            {mode === "chosen" && <>
              <Label htmlFor="featured-document">Document</Label>
              {documents.isError ? <ErrorState onRetry={() => documents.refetch()} /> :
                <select id="featured-document" value={documentId} onChange={(e) => setDocumentId(e.target.value)} disabled={documents.isLoading} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base" data-testid="select-featured-document">
                  <option value="">{documents.isLoading ? "Loading documents…" : "Choose a live document"}</option>
                  {documentId && !selectedAvailable && <option value={documentId} disabled>Saved document is no longer available</option>}
                  {(documents.data ?? []).map(doc => <option key={doc.id} value={doc.id}>{doc.title}{doc.year ? ` (${doc.year})` : ""}</option>)}
                </select>}
              <Label htmlFor="featured-label">Label (optional)</Label>
              <Input id="featured-label" maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Featured:" data-testid="input-featured-label" />
              <p className="text-sm text-muted-foreground">Members only see the line if they can access the chosen document.</p>
            </>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="slideshow-url">Slideshow embed URL</Label>
            <Input id="slideshow-url" type="url" inputMode="url" maxLength={2048} placeholder="https://photos.smugmug.com/frame/..." value={url} onChange={(e) => setUrl(e.target.value)} data-testid="input-slideshow-url" />
            <p className="text-sm text-muted-foreground">Use an HTTPS embed URL on a SmugMug subdomain. Leave empty to hide the slideshow.</p>
            {!!url.trim() && !/^https:\/\//i.test(url.trim()) && <p className="text-sm text-destructive" data-testid="text-slideshow-invalid">The link must start with https://</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={!dirty || invalid || save.isPending} data-testid="button-save-home-display">{save.isPending ? "Saving…" : dirty ? "Save home page" : "Saved"}</Button>
            {!!display.data?.slideshowEmbedUrl && <Button variant="outline" onClick={() => setUrl("")} disabled={save.isPending} data-testid="button-clear-slideshow">Remove slideshow</Button>}
            {dirty && <span className="text-sm text-primary" data-testid="text-home-unsaved">Unsaved changes</span>}
          </div>
        </section>}
      <section className="mt-6 max-w-2xl rounded-2xl border bg-card p-5 md:p-6 space-y-3">
        <h2 className="text-xl">Family time</h2>
        <p className="text-sm text-muted-foreground">Check the Scheduler now, without using the Home page cache.</p>
        <Button variant="outline" onClick={() => void familyTime.refetch()} disabled={familyTime.isFetching} data-testid="button-check-family-time">
          {familyTime.isFetching ? "Checking…" : "Check family time"}
        </Button>
        {familyTime.isError ? <p role="alert" className="text-sm text-destructive">{errorMessage(familyTime.error, "Couldn't check family time. Please try again.")}</p> :
          familyTime.data && !familyTime.isFetching && <p role="status" className="text-sm break-words" data-testid="family-time-check-result">
            {familyTime.data.ok ? `OK · Year ${familyTime.data.year} · ${familyTime.data.slotCount} slots` :
              `Unavailable · ${familyTime.data.reason} · Year ${familyTime.data.year} · ${familyTime.data.slotCount} slots`}
          </p>}
      </section>
    </div>
  );
}
