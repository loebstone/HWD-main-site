import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetHomeDisplayQueryKey, getGetHomeQueryKey, useGetHomeDisplay, useUpdateHomeDisplay } from "@workspace/api-client-react";
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
  const save = useUpdateHomeDisplay();
  const [url, setUrl] = useState("");
  const saved = useRef<string | null>(null);
  const dirty = saved.current !== null && url.trim() !== saved.current;
  const invalid = !!url.trim() && !/^https:\/\//i.test(url.trim());

  useEffect(() => {
    if (!display.data) return;
    if (saved.current !== null && url.trim() !== saved.current) return;
    saved.current = display.data.slideshowEmbedUrl ?? "";
    setUrl(saved.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.data]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  async function submit() {
    const v = url.trim();
    try {
      const res = await save.mutateAsync({ data: { slideshowEmbedUrl: v ? v : null } });
      saved.current = res.slideshowEmbedUrl ?? "";
      setUrl(saved.current);
      await Promise.all([qc.invalidateQueries({ queryKey: getGetHomeDisplayQueryKey() }), qc.invalidateQueries({ queryKey: getGetHomeQueryKey() })]);
      toast({ title: "Home page updated", description: saved.current ? "Slideshow will show on Home." : "Slideshow hidden." });
    } catch (err) {
      toast({ title: "Couldn't save", description: errorMessage(err, "Please check the link and try again."), variant: "destructive" });
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Home" intro="Set the slideshow shown on the family home page, below announcements. Leave empty to hide it." />
      <AdminTabs />
      {display.isLoading ? <ListSkeleton rows={2} /> : display.isError ? <ErrorState onRetry={() => display.refetch()} /> :
        <section className="max-w-2xl rounded-2xl border bg-card p-5 md:p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="slideshow-url">Slideshow embed URL</Label>
            <Input id="slideshow-url" type="url" inputMode="url" maxLength={2048} placeholder="https://photos.smugmug.com/frame/..." value={url} onChange={(e) => setUrl(e.target.value)} data-testid="input-slideshow-url" />
            <p className="text-sm text-muted-foreground">Use an HTTPS embed URL on a SmugMug subdomain. Leave empty to hide the slideshow.</p>
            {invalid && <p className="text-sm text-destructive" data-testid="text-slideshow-invalid">The link must start with https://</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={!dirty || invalid || save.isPending} data-testid="button-save-home-display">{save.isPending ? "Saving…" : dirty ? "Save home page" : "Saved"}</Button>
            {!!saved.current && <Button variant="outline" onClick={() => setUrl("")} disabled={save.isPending} data-testid="button-clear-slideshow">Remove slideshow</Button>}
            {dirty && <span className="text-sm text-primary" data-testid="text-home-unsaved">Unsaved changes</span>}
          </div>
        </section>}
    </div>
  );
}
