import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  getGetHomeNoticeQueryKey, getGetPublicHomeNoticeQueryKey, getListAnnouncementsQueryKey,
  getListGrantsQueryKey, useCreateAnnouncement, useCreateGrant, useEndGrant,
  useGetHomeNotice, useListAnnouncements, useListAuditLog, useListGrants,
  useRetireAnnouncement, useUpdateAnnouncement, useUpdateHomeNotice,
  type Announcement, type AnnouncementInput, type AuditAction, type GrantInput, type HomeNoticeInput,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { useSession } from "@/lib/session";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Form } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const announcementToday = new Date().toISOString().slice(0, 10);
const defaultHideDate = new Date(`${announcementToday}T00:00:00.000Z`);
defaultHideDate.setUTCDate(defaultHideDate.getUTCDate() + 60);
const ANNOUNCEMENT_DEFAULT: AnnouncementInput = { title: "", body: "", date: announcementToday, placement: "announcements", hideAfter: defaultHideDate.toISOString().slice(0, 10) };

export function AdminAnnouncementsPage() {
  const client = useQueryClient();
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [showPast, setShowPast] = useState(true);
  const list = useListAnnouncements({ showPast });
  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement();
  const retire = useRetireAnnouncement();
  const form = useForm<AnnouncementInput>({ defaultValues: ANNOUNCEMENT_DEFAULT });
  const busy = create.isPending || update.isPending;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getListAnnouncementsQueryKey({ showPast: false }) });
    void client.invalidateQueries({ queryKey: getListAnnouncementsQueryKey({ showPast: true }) });
  };
  function startEdit(item: Announcement) {
    setEditing(item);
    form.reset({ title: item.title, body: item.body, date: item.date.slice(0, 10), placement: item.placement, hideAfter: item.hideAfter.slice(0, 10) });
    document.getElementById("announcement-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function submit(values: AnnouncementInput) {
    const action = editing ? update.mutateAsync({ id: editing.id, data: values }) : create.mutateAsync({ data: values });
    void action.then(() => { form.reset(ANNOUNCEMENT_DEFAULT); setEditing(null); refresh(); });
  }
  return <div>
    <PageHeader eyebrow="Administration" title="Announcements" intro="Write, update, and retire family news." />
    <AdminTabs />
    <section id="announcement-form" className="mb-9 rounded-xl border bg-card p-5 md:p-6">
      <h2 className="text-2xl">{editing ? "Edit announcement" : "Write an announcement"}</h2>
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} className="mt-5 grid gap-4 md:grid-cols-2" data-testid="form-announcement">
        <div className="space-y-1.5"><Label htmlFor="announcement-title">Title</Label><Input id="announcement-title" maxLength={250} {...form.register("title", { required: true })} data-testid="input-announcement-title" /></div>
        <div className="space-y-1.5"><Label htmlFor="announcement-date">Date</Label><Input id="announcement-date" type="date" {...form.register("date", { required: true })} data-testid="input-announcement-date" /></div>
        <div className="space-y-1.5"><Label htmlFor="announcement-placement">Placement</Label>
          <Select value={form.watch("placement")} onValueChange={(value) => { if (value === "announcements" || value === "reminders" || value === "both") form.setValue("placement", value); }}>
            <SelectTrigger id="announcement-placement" data-testid="select-announcement-placement"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="announcements">Announcements</SelectItem><SelectItem value="reminders">Home reminders</SelectItem><SelectItem value="both">Both</SelectItem></SelectContent>
          </Select></div>
        <div className="space-y-1.5"><Label htmlFor="announcement-hide-after">Hide after</Label><Input id="announcement-hide-after" type="date" {...form.register("hideAfter", { required: true })} data-testid="input-announcement-hide-after" /></div>
        <div className="space-y-1.5 md:col-span-2"><Label htmlFor="announcement-body">Message</Label><Textarea id="announcement-body" rows={5} maxLength={10000} {...form.register("body")} data-testid="input-announcement-body" /></div>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" disabled={busy} data-testid="button-save-announcement">{busy ? "Saving…" : editing ? "Save changes" : "Publish announcement"}</Button>
          {editing && <Button type="button" variant="outline" onClick={() => { setEditing(null); form.reset(ANNOUNCEMENT_DEFAULT); }} data-testid="button-cancel-announcement">Cancel</Button>}
        </div>
      </form></Form>
    </section>
    <div className="mb-4 flex justify-end"><Button variant="outline" onClick={() => setShowPast((v) => !v)} data-testid="button-admin-toggle-past">{showPast ? "Hide past" : "Show past"}</Button></div>
    {list.isLoading ? <ListSkeleton rows={3} /> : list.isError ? <ErrorState onRetry={() => list.refetch()} /> :
      !list.data?.length ? <p className="rounded-xl border bg-card p-6 text-muted-foreground">No announcements to manage.</p> :
        <div className="space-y-3">{list.data.map((item) => <article key={item.id} className="rounded-xl border bg-card p-5" data-testid={`admin-announcement-${item.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl">{item.title}</h3><p className="text-sm text-muted-foreground">{item.date} · {item.placement}{item.retiredAt ? " · Retired" : ""}</p></div>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => startEdit(item)} data-testid={`button-edit-announcement-${item.id}`}>Edit</Button>
              {!item.retiredAt && <Button size="sm" variant="destructive" disabled={retire.isPending} onClick={() => { if (window.confirm(`Retire “${item.title}”?`)) void retire.mutateAsync({ id: item.id }).then(refresh); }} data-testid={`button-retire-announcement-${item.id}`}>Retire</Button>}</div></div>
          <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{item.body}</p>
        </article>)}</div>}
  </div>;
}

export function AdminHomeNoticePage() {
  const client = useQueryClient();
  const query = useGetHomeNotice();
  const mutation = useUpdateHomeNotice();
  const form = useForm<HomeNoticeInput>({ defaultValues: { text: "", visibility: "signed-in" } });
  useEffect(() => { if (query.data) form.reset(query.data); }, [query.data, form]);
  return <div>
    <PageHeader eyebrow="Administration" title="Home notice" intro="A short message at the top of the family home page." />
    <AdminTabs />
    {query.isLoading ? <ListSkeleton rows={2} /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> :
      <section className="max-w-2xl rounded-xl border bg-card p-5 md:p-7">
        <Form {...form}><form className="space-y-5" onSubmit={form.handleSubmit((data) => mutation.mutate({ data }, { onSuccess: () => { void client.invalidateQueries({ queryKey: getGetHomeNoticeQueryKey() }); void client.invalidateQueries({ queryKey: getGetPublicHomeNoticeQueryKey() }); } }))} data-testid="form-home-notice">
          <div className="space-y-1.5"><Label htmlFor="notice-text">Notice text</Label><Textarea id="notice-text" rows={7} maxLength={10000} {...form.register("text")} data-testid="input-home-notice" /><p className="text-sm text-muted-foreground">Plain text is supported. Web addresses become clickable on the home page.</p></div>
          <div className="space-y-1.5"><Label htmlFor="notice-visibility">Who can see it?</Label>
            <Select value={form.watch("visibility")} onValueChange={(value) => { if (value === "signed-in" || value === "public") form.setValue("visibility", value); }}>
              <SelectTrigger id="notice-visibility" data-testid="select-notice-visibility"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="signed-in">Signed-in family only</SelectItem><SelectItem value="public">Public, including sign-in page</SelectItem></SelectContent>
            </Select></div>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-home-notice">{mutation.isPending ? "Saving…" : "Save notice"}</Button>
          {mutation.isError && <p className="text-sm text-destructive" role="alert" data-testid="status-notice-error">The notice could not be saved. Please try again.</p>}
        </form></Form>
      </section>}
  </div>;
}

export function AdminPeoplePage() {
  const client = useQueryClient();
  const { data: me } = useSession();
  const grants = useListGrants();
  const create = useCreateGrant();
  const end = useEndGrant();
  const form = useForm<GrantInput>({ defaultValues: { personId: "", displayName: "", role: "editor" } });
  return <div>
    <PageHeader eyebrow="Administration" title="People & access" intro="Grant or end editing and administrator access." />
    <AdminTabs />
    <section className="mb-8 max-w-2xl rounded-xl border bg-card p-5">
      <h2 className="text-2xl">Grant access</h2>
      <Form {...form}><form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((data) => create.mutate({ data }, { onSuccess: () => { form.reset({ personId: "", displayName: "", role: "editor" }); void client.invalidateQueries({ queryKey: getListGrantsQueryKey() }); } }))} data-testid="form-create-grant">
        <div className="space-y-1"><Label htmlFor="grant-person-id">Person ID</Label><Input id="grant-person-id" required {...form.register("personId", { required: true })} data-testid="input-grant-person-id" /></div>
        <div className="space-y-1"><Label htmlFor="grant-name">Display name</Label><Input id="grant-name" required {...form.register("displayName", { required: true })} data-testid="input-grant-display-name" /></div>
        <div className="space-y-1"><Label htmlFor="grant-role">Role</Label><Select value={form.watch("role")} onValueChange={(value) => form.setValue("role", value as GrantInput["role"])}><SelectTrigger id="grant-role" data-testid="select-grant-role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="editor">Editor</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent></Select></div>
        <div className="flex items-end"><Button type="submit" disabled={create.isPending} data-testid="button-create-grant">{create.isPending ? "Adding…" : "Grant access"}</Button></div>
      </form></Form>
    </section>
    <h2 className="mb-3 text-2xl">Active grants</h2>
    {grants.isLoading ? <ListSkeleton rows={3} /> : grants.isError ? <ErrorState onRetry={() => grants.refetch()} /> :
      !(grants.data || []).filter((g) => !g.endedAt).length ? <p className="rounded-xl border bg-card p-5 text-muted-foreground">No active grants.</p> :
         <div className="space-y-3">{(grants.data || []).filter((g) => !g.endedAt).map((grant) => {
           const activeAdmins = (grants.data || []).filter((item) => item.role === "admin" && !item.endedAt);
           const cannotEndLastSelf = grant.role === "admin" && grant.personId === me?.personId && activeAdmins.length <= 1;
           return <article key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5" data-testid={`grant-${grant.id}`}>
          <div><h3 className="font-medium">{grant.displayName}</h3><p className="text-sm text-muted-foreground">{grant.personId} · {grant.role} · granted by {grant.grantedBy} on {new Date(grant.grantedAt).toLocaleDateString()}</p></div>
          <Button size="sm" variant="outline" disabled={end.isPending || cannotEndLastSelf} title={cannotEndLastSelf ? "The last active administrator cannot end their own grant." : undefined} onClick={() => { if (window.confirm(`End ${grant.role} access for ${grant.displayName}?`)) end.mutate({ id: grant.id }, { onSuccess: () => void client.invalidateQueries({ queryKey: getListGrantsQueryKey() }) }); }} data-testid={`button-end-grant-${grant.id}`}>End access</Button>
        </article>;
         })}</div>}
    {!!grants.data?.some((grant) => !!grant.endedAt) && <section className="mt-8"><h2 className="mb-3 text-2xl">Access history</h2><div className="space-y-2">{grants.data.filter((grant) => !!grant.endedAt).map((grant) => <div key={grant.id} className="rounded-lg border bg-muted/40 px-4 py-3 text-sm" data-testid={`grant-history-${grant.id}`}>{grant.displayName} · {grant.role} · ended {new Date(grant.endedAt!).toLocaleDateString()}</div>)}</div></section>}
  </div>;
}

const ACTIONS: AuditAction[] = ["sign-in", "sign-out", "document-open", "document-upload", "document-replace", "document-retire", "document-edit", "document-move", "group-create", "group-edit", "group-retire", "home-edit", "grant-create", "grant-end", "announcement-create", "announcement-edit", "announcement-retire", "notice-edit", "apps-edit", "menu-edit", "contact-send", "contact-settings-edit", "import", "view-as-member-on", "view-as-member-off", "dues-settings-edit"];
export function AdminAuditPage() {
  const [personId, setPersonId] = useState("all");
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(1);
  const params = { page, ...(personId !== "all" ? { personId } : {}), ...(action !== "all" ? { action: action as AuditAction } : {}) };
  const query = useListAuditLog(params);
  return <div>
    <PageHeader eyebrow="Administration" title="Audit log" intro="A record of sign-ins and changes across the family site." />
    <AdminTabs />
    <div className="mb-5 grid gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="audit-person">Person ID</Label><Input id="audit-person" value={personId === "all" ? "" : personId} onChange={(event) => { setPersonId(event.target.value || "all"); setPage(1); }} placeholder="All people" data-testid="input-audit-person" /></div>
      <div className="space-y-1"><Label htmlFor="audit-action">Action</Label><Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}><SelectTrigger id="audit-action" data-testid="select-audit-action"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All actions</SelectItem>{ACTIONS.map((a) => <SelectItem key={a} value={a}>{a.replaceAll("-", " ")}</SelectItem>)}</SelectContent></Select></div>
    </div>
    {query.isLoading ? <ListSkeleton rows={5} /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> :
      !query.data?.items.length ? <p className="rounded-xl border bg-card p-6 text-muted-foreground" data-testid="empty-audit">No audit entries match these filters.</p> :
        <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b bg-muted/50 text-muted-foreground"><tr><th className="p-3">When</th><th className="p-3">Person</th><th className="p-3">Action</th><th className="p-3">Details</th><th className="p-3">Visitor address</th></tr></thead><tbody>{query.data.items.map((entry) => <tr key={entry.id} className="border-b last:border-0" data-testid={`audit-row-${entry.id}`}><td className="p-3 whitespace-nowrap">{new Date(entry.at).toLocaleString()}</td><td className="p-3">{entry.actorName}</td><td className="p-3">{entry.action}</td><td className="p-3">{entry.description}</td><td className="p-3">{entry.visitorAddress}</td></tr>)}</tbody></table></div>}
    {query.data && <div className="mt-4 flex items-center justify-between"><span className="text-sm text-muted-foreground">Page {query.data.page} · {query.data.total} entries</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => setPage((p) => p - 1)} data-testid="button-audit-previous">Previous</Button><Button variant="outline" disabled={page * query.data.pageSize >= query.data.total || query.isFetching} onClick={() => setPage((p) => p + 1)} data-testid="button-audit-next">Next</Button></div></div>}
  </div>;
}
