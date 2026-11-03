import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetDuesQueryKey, getGetDuesSettingsQueryKey, useGetDuesSettings, useUpdateDuesSettings } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { ErrorState, ListSkeleton } from "@/components/states";
import { NoticeText } from "@/components/notice-text";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/session";

export function AdminDuesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const settings = useGetDuesSettings();
  const save = useUpdateDuesSettings();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const saved = useRef<{ open: boolean; text: string } | null>(null);
  const dirty = !!saved.current && (open !== saved.current.open || text !== saved.current.text);

  useEffect(() => {
    if (!settings.data) return;
    // Only reset when not holding unsaved edits.
    if (saved.current && (open !== saved.current.open || text !== saved.current.text)) return;
    saved.current = { open: settings.data.seasonOpen, text: settings.data.text };
    setOpen(settings.data.seasonOpen); setText(settings.data.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  async function submit() {
    try {
      const res = await save.mutateAsync({ data: { seasonOpen: open, text } });
      saved.current = { open: res.seasonOpen, text: res.text };
      setOpen(res.seasonOpen); setText(res.text);
      await Promise.all([qc.invalidateQueries({ queryKey: getGetDuesSettingsQueryKey() }), qc.invalidateQueries({ queryKey: getGetDuesQueryKey() })]);
      toast({ title: "Dues settings saved", description: res.seasonOpen ? "Season is open." : "Season is closed." });
    } catch (err) {
      toast({ title: "Couldn't save", description: errorMessage(err, "Please try again."), variant: "destructive" });
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Dues" intro="Open or close dues season and write what members see on the Dues page. Links in the text become clickable." />
      <AdminTabs />
      {settings.isLoading ? <ListSkeleton rows={3} /> : settings.isError ? <ErrorState onRetry={() => settings.refetch()} /> :
        <div className="grid lg:grid-cols-[1fr_22rem] gap-6 items-start">
          <section className="rounded-2xl border bg-card p-5 md:p-6 space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/40 px-4 py-3">
              <div><Label htmlFor="dues-open" className="text-base">Dues season open</Label>
                <p className="text-sm text-muted-foreground">When closed, members see a closed-season message.</p></div>
              <Switch id="dues-open" checked={open} onCheckedChange={setOpen} data-testid="switch-dues-open" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dues-text">Text for members</Label>
              <Textarea id="dues-text" rows={10} maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} data-testid="input-dues-text" />
              <p className="text-xs text-muted-foreground tabular-nums">{text.length} / 10000</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={submit} disabled={!dirty || save.isPending} data-testid="button-save-dues">{save.isPending ? "Saving…" : dirty ? "Save dues settings" : "Saved"}</Button>
              {dirty && <span className="text-sm text-primary" data-testid="text-dues-unsaved">Unsaved changes</span>}
            </div>
          </section>
          <aside className="rounded-2xl border bg-card p-5 md:p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Preview</p>
            <div className="mt-3" data-testid="preview-dues">
              {open && text.trim() ? <NoticeText text={text} /> : <p className="text-muted-foreground">Dues season is closed.</p>}
            </div>
          </aside>
        </div>}
    </div>
  );
}
