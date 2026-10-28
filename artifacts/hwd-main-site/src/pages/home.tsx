import { Link } from "wouter";
import { useGetHome, useListAnnouncements } from "@workspace/api-client-react";
import { ArrowRight } from "lucide-react";
import { useSession, nameOf } from "@/lib/session";
import { DocumentCard } from "@/components/document-card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { NoticeText } from "@/components/notice-text";
import { formatDate } from "@/lib/docs";

export default function HomePage() {
  const { data: me } = useSession();
  const home = useGetHome();
  const notice = home.data?.notice;
  const announcements = useListAnnouncements({ showPast: false });
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

      {notice?.text && <section className="rounded-xl border-l-4 border-primary bg-accent/50 px-5 py-4" data-testid="notice-home">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">A note for the family</p>
        <p className="mt-1"><NoticeText text={notice.text} /></p>
      </section>}

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

      {home.isLoading ? <section className="grid sm:grid-cols-2 gap-4"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /></section> :
        !!home.data?.featuredGroups.length && <section data-testid="section-quick-access">
        <div className="mb-4"><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Quick access</p><h2 className="mt-1 text-2xl md:text-3xl leading-snug" data-testid="heading-quick-access">Family records</h2></div>
        <div className="grid sm:grid-cols-2 gap-4" data-testid="section-featured-groups">
        {home.data.featuredGroups.map((g, i) => (
          <Link key={g.id} href={`/documents/${g.slug}`} style={{ animationDelay: `${i * 60}ms` }}
            className="rise group min-w-0 rounded-xl border bg-card p-5 hover:border-primary/40 hover:shadow-md transition-all"
            data-testid={`link-quick-${g.slug}`}>
            <span className="flex items-center justify-between gap-3 font-display text-2xl">
              <span className="min-w-0 break-words">{g.name}</span><ArrowRight className="h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-1" />
            </span>
            {g.description && <span className="mt-1 block text-muted-foreground break-words">{g.description}</span>}
            <span className="mt-3 block text-sm text-muted-foreground truncate">
              {g.documentCount} {g.documentCount === 1 ? "document" : "documents"}{g.latestTitle ? ` · Latest: ${g.latestTitle}` : ""}{g.latestDate ? `, ${formatDate(g.latestDate)}` : ""}
            </span>
          </Link>
        ))}
        </div>
      </section>}

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
