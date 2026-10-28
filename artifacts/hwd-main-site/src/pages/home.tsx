import { Link } from "wouter";
import { useGetAppLinks, useGetHome, useGetHomeNotice, useListAnnouncements } from "@workspace/api-client-react";
import { ArrowRight, CalendarDays, CloudSun, TableProperties, UsersRound } from "lucide-react";
import { useSession, nameOf } from "@/lib/session";
import { DocumentCard } from "@/components/document-card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { NoticeText } from "@/components/notice-text";

const QUICK = [
  { href: "/meetings", label: "Meetings", text: "Shareholders' and directors' minutes, by year" },
  { href: "/governing", label: "Governing Docs & Policies", text: "Bylaws, agreements and house rules" },
  { href: "/logging", label: "Logging", text: "Forestry plans and harvest records" },
  { href: "/photo-archive", label: "Photo Archive", text: "Albums and pictures through the years" },
];

export default function HomePage() {
  const { data: me } = useSession();
  const home = useGetHome();
  const notice = useGetHomeNotice();
  const announcements = useListAnnouncements({ showPast: false });
  const apps = useGetAppLinks();
  const appIcons = { calendar: CalendarDays, roster: UsersRound, forecast: CloudSun, "cap-table": TableProperties };
  const img = `${import.meta.env.BASE_URL}images/hwd-farm-illustration.jpg`;

  return (
    <div className="space-y-14">
      <section className="rise">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Lee, Massachusetts</p>
        <h1 className="mt-2 text-2xl sm:text-4xl md:text-5xl leading-snug break-words" data-testid="text-greeting">
          Good to see you, {me ? nameOf(me) : ""}.
        </h1>
        <figure className="mt-8 overflow-hidden rounded-2xl border shadow-lg bg-card">
          <img src={img} alt="Illustration of HWD Farm" className="w-full aspect-[16/9] md:aspect-[21/9] object-cover" data-testid="img-hero" />
        </figure>
      </section>

      {notice.data?.text && <section className="rounded-xl border-l-4 border-primary bg-accent/50 px-5 py-4" data-testid="notice-home">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">A note for the family</p>
        <p className="mt-1"><NoticeText text={notice.data.text} /></p>
      </section>}

      <section>
        <div className="flex items-end justify-between gap-4 mb-4">
          <div><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Quick access</p><h2 className="mt-1 text-2xl md:text-3xl leading-snug">Farm apps</h2></div>
        </div>
        {apps.isLoading ? <div className="grid sm:grid-cols-2 gap-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> :
          apps.isError ? <ErrorState onRetry={() => apps.refetch()} /> : !apps.data?.length ?
            <p className="text-muted-foreground" data-testid="empty-app-links">Farm apps are not set up yet.</p> :
            <div className="grid sm:grid-cols-2 gap-3">{apps.data.map((app) => {
              const Icon = appIcons[app.id];
              return <a key={app.id} href={app.url} className="group flex items-center gap-4 rounded-xl border bg-card px-5 py-4 transition-colors hover:border-primary/40" data-testid={`link-app-${app.id}`}>
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><Icon className="h-5 w-5" /></span>
                <span className="flex-1 font-medium">{app.label}</span><ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </a>;
            })}</div>}
      </section>

      <section>
        <div className="flex items-end justify-between mb-4">
          <div><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">For this week</p><h2 className="mt-1 text-2xl md:text-3xl leading-snug">Reminders</h2></div>
          <Link href="/announcements" className="text-sm text-primary underline underline-offset-4" data-testid="link-all-announcements">All announcements</Link>
        </div>
        {announcements.isLoading ? <ListSkeleton rows={2} /> : announcements.isError ? <ErrorState onRetry={() => announcements.refetch()} /> :
          !(announcements.data || []).filter((a) => a.placement === "reminders" || a.placement === "both").length ?
            <p className="rounded-xl border bg-card px-5 py-6 text-muted-foreground" data-testid="empty-reminders">There are no current reminders.</p> :
            <div className="space-y-3">{(announcements.data || []).filter((a) => a.placement === "reminders" || a.placement === "both").slice(0, 5).map((item) =>
              <article key={item.id} className="rounded-xl border bg-card px-5 py-4" data-testid={`reminder-${item.id}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-xl">{item.title}</h3><time className="text-sm text-muted-foreground">{new Date(item.date).toLocaleDateString()}</time></div>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{item.body}</p>
              </article>)}</div>}
      </section>

      <section className="grid sm:grid-cols-2 gap-4">
        {QUICK.map((q, i) => (
          <Link key={q.href} href={q.href} style={{ animationDelay: `${i * 60}ms` }}
            className="rise group rounded-xl border bg-card p-5 hover:border-primary/40 hover:shadow-md transition-all"
            data-testid={`link-quick-${q.href.slice(1)}`}>
            <span className="flex items-center justify-between font-display text-2xl">
              {q.label}<ArrowRight className="h-5 w-5 text-primary transition-transform group-hover:translate-x-1" />
            </span>
            <span className="mt-1 block text-muted-foreground">{q.text}</span>
          </Link>
        ))}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="text-2xl md:text-3xl leading-snug">Recently added</h2>
          {home.isLoading ? <Skeleton className="h-5 w-24" /> : home.data &&
            <span className="text-muted-foreground" data-testid="text-document-count">{home.data.documentCount} documents in all</span>}
        </div>
        {home.isLoading ? <ListSkeleton rows={3} /> : home.isError ? <ErrorState onRetry={() => home.refetch()} /> :
          !home.data?.recentDocuments.length ? <EmptyState title="Nothing has been added yet">New documents will show up here as they're added.</EmptyState> :
          <div className="space-y-4">{home.data.recentDocuments.map((d) => <DocumentCard key={d.id} doc={d} />)}</div>}
      </section>
    </div>
  );
}
