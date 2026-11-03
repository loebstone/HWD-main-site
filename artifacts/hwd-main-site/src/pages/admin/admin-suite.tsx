import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminContactQueryKey, getGetAdminSuiteMenuQueryKey, getGetContactStatusQueryKey, getGetSuiteMenuQueryKey,
  useGetAdminContact, useGetAdminSuiteMenu, useUpdateContactSettings, useUpdateSuiteMenu,
  type SuiteItem, type SuiteTool,
} from "@workspace/api-client-react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/session";
import { DEFAULT_ITEMS, DEFAULT_TOOLS, sortItems } from "@/lib/suite-menu";

export function AdminSuiteMenuPage() {
  const client = useQueryClient();
  const query = useGetAdminSuiteMenu({ query: { queryKey: getGetAdminSuiteMenuQueryKey(), staleTime: 0, refetchOnMount: "always" } });
  const update = useUpdateSuiteMenu();
  const [items, setItems] = useState<SuiteItem[]>([]);
  const [tools, setTools] = useState<SuiteTool[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const initVersion = useRef<number | null>(null);

  useEffect(() => {
    const d = query.data;
    if (!d || initVersion.current === d.version) return;
    initVersion.current = d.version;
    const byId = Object.fromEntries(d.items.map((i) => [i.id, i]));
    setItems(sortItems(DEFAULT_ITEMS.map((def) => byId[def.id] ?? def)).map((i, idx) => ({ ...i, order: idx })));
    const tById = Object.fromEntries(d.tools.map((t) => [t.id === "cap-table" ? "captable" : t.id, t]));
    setTools(DEFAULT_TOOLS.map((def) => ({ ...(tById[def.id] ?? def), id: def.id })));
  }, [query.data]);

  const move = (idx: number, dir: -1 | 1) => setItems((list) => {
    const next = [...list]; const j = idx + dir;
    if (j < 0 || j >= next.length) return list;
    [next[idx], next[j]] = [next[j], next[idx]];
    return next.map((i, k) => ({ ...i, order: k }));
  });

  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    try {
      const res = await update.mutateAsync({ data: { items: items.map((i, k) => ({ ...i, order: k })), tools } });
      initVersion.current = null;
      client.setQueryData(getGetAdminSuiteMenuQueryKey(), res);
      void client.invalidateQueries({ queryKey: getGetAdminSuiteMenuQueryKey() });
      void client.invalidateQueries({ queryKey: getGetSuiteMenuQueryKey() });
      setMsg({ ok: true, text: "Menu saved." });
    } catch (err) { setMsg({ ok: false, text: errorMessage(err, "The menu could not be saved. Please try again.") }); }
  }

  return <div>
    <PageHeader eyebrow="Administration" title="Suite menu" intro="The links across the top of every Farm page, and the Tools shown to people who have them." />
    <AdminTabs />
    {query.isLoading || (query.data && !items.length) ? <ListSkeleton rows={6} /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> :
      <form className="max-w-3xl space-y-8" onSubmit={save} data-testid="form-suite-menu">
        <section><h2 className="mb-3 text-2xl">Menu items</h2>
          <ol className="space-y-3">{items.map((it, idx) => <li key={it.id} className="rounded-xl border bg-card p-4" data-testid={`row-menu-item-${it.id}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{idx + 1} · {it.id}</span>
              <span className="flex gap-1">
                <Button type="button" size="icon" variant="outline" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label={`Move ${it.label} up`} data-testid={`button-menu-up-${it.id}`}><ArrowUp className="h-4 w-4" /></Button>
                <Button type="button" size="icon" variant="outline" disabled={idx === items.length - 1} onClick={() => move(idx, 1)} aria-label={`Move ${it.label} down`} data-testid={`button-menu-down-${it.id}`}><ArrowDown className="h-4 w-4" /></Button>
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor={`menu-label-${it.id}`}>Label</Label><Input id={`menu-label-${it.id}`} required maxLength={100} value={it.label} onChange={(e) => setItems((l) => l.map((x) => x.id === it.id ? { ...x, label: e.target.value } : x))} data-testid={`input-menu-label-${it.id}`} /></div>
              <div className="space-y-1"><Label htmlFor={`menu-href-${it.id}`}>Link</Label><Input id={`menu-href-${it.id}`} maxLength={2048} value={it.href} onChange={(e) => setItems((l) => l.map((x) => x.id === it.id ? { ...x, href: e.target.value } : x))} data-testid={`input-menu-href-${it.id}`} /></div>
            </div>
          </li>)}</ol>
        </section>
        <section><h2 className="mb-1 text-2xl">Tools</h2><p className="mb-3 text-sm text-muted-foreground">Shown only to people with access to each tool.</p>
          <div className="space-y-3">{tools.map((t) => <div key={t.id} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2" data-testid={`row-menu-tool-${t.id}`}>
            <div className="space-y-1"><Label htmlFor={`tool-label-${t.id}`}>Label</Label><Input id={`tool-label-${t.id}`} required maxLength={100} value={t.label} onChange={(e) => setTools((l) => l.map((x) => x.id === t.id ? { ...x, label: e.target.value } : x))} data-testid={`input-tool-label-${t.id}`} /></div>
            <div className="space-y-1"><Label htmlFor={`tool-href-${t.id}`}>Link</Label><Input id={`tool-href-${t.id}`} maxLength={2048} value={t.href} onChange={(e) => setTools((l) => l.map((x) => x.id === t.id ? { ...x, href: e.target.value } : x))} data-testid={`input-tool-href-${t.id}`} /></div>
          </div>)}</div>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={update.isPending} data-testid="button-save-suite-menu">{update.isPending ? "Saving…" : "Save menu"}</Button>
          {msg && <p className={msg.ok ? "text-sm text-primary" : "text-sm text-destructive"} role={msg.ok ? "status" : "alert"} data-testid={msg.ok ? "status-suite-menu-saved" : "status-suite-menu-error"}>{msg.text}</p>}
        </div>
      </form>}
  </div>;
}

export function AdminContactPage() {
  const client = useQueryClient();
  const query = useGetAdminContact({ query: { queryKey: getGetAdminContactQueryKey(), staleTime: 0, refetchOnMount: "always" } });
  const update = useUpdateContactSettings();
  const [recipient, setRecipient] = useState("");
  const [textAboveForm, setTextAboveForm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const initialized = useRef(false);
  useEffect(() => { if (query.data && !initialized.current) { initialized.current = true; setRecipient(query.data.recipient); setTextAboveForm(query.data.textAboveForm ?? ""); } }, [query.data]);

  async function save(value: string) {
    setMsg(null);
    try {
      const res = await update.mutateAsync({ data: { recipient: value.trim(), textAboveForm } });
      setRecipient(res.recipient);
      setTextAboveForm(res.textAboveForm ?? "");
      client.setQueryData(getGetAdminContactQueryKey(), res);
      void client.invalidateQueries({ queryKey: getGetAdminContactQueryKey() });
      void client.invalidateQueries({ queryKey: getGetContactStatusQueryKey() });
      setMsg({ ok: true, text: res.recipient ? "Saved." : "Cleared. Contact is now turned off." });
    } catch (err) { setMsg({ ok: false, text: errorMessage(err, "Could not save. Please try again.") }); }
  }

  return <div>
    <PageHeader eyebrow="Administration" title="Contact" intro="Where messages from the Contact page are delivered. Members never see this address." />
    <AdminTabs />
    {query.isLoading ? <ListSkeleton rows={1} /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> :
      <form className="max-w-xl space-y-4 rounded-xl border bg-card p-5 md:p-7" onSubmit={(e) => { e.preventDefault(); void save(recipient); }} data-testid="form-contact-settings">
        <div className="space-y-1.5"><Label htmlFor="contact-recipient">Contact messages go to:</Label>
          <Input id="contact-recipient" type="email" maxLength={320} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="name@example.org" data-testid="input-contact-recipient" />
          <p className="text-sm text-muted-foreground">Leave empty to turn Contact off.</p></div>
        <div className="space-y-1.5"><Label htmlFor="contact-text-above-form">Text above the form</Label>
          <Textarea id="contact-text-above-form" rows={3} maxLength={300} value={textAboveForm} onChange={(e) => setTextAboveForm(e.target.value)} data-testid="input-contact-text-above-form" />
          <p className="text-sm text-muted-foreground">{textAboveForm.length} / 300</p></div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={update.isPending} data-testid="button-save-contact-settings">{update.isPending ? "Saving…" : "Save"}</Button>
          <Button type="button" variant="outline" disabled={update.isPending} onClick={() => { setRecipient(""); void save(""); }} data-testid="button-clear-contact-settings">Clear</Button>
        </div>
        {msg && <p className={msg.ok ? "text-sm text-primary" : "text-sm text-destructive"} role={msg.ok ? "status" : "alert"} data-testid={msg.ok ? "status-contact-settings-saved" : "status-contact-settings-error"}>{msg.text}</p>}
      </form>}
  </div>;
}
