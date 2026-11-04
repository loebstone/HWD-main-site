import { Link } from "wouter";
import { useGetHome, type FamilyTime, type HomeCard } from "@workspace/api-client-react";
import { ArrowRight, ArrowUpRight, CalendarDays, FileText } from "lucide-react";
import { useSession, nameOf } from "@/lib/session";
import { ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { NoticeText } from "@/components/notice-text";
import { openUrl } from "@/lib/docs";
import { familyRows, formatRange, safeColor } from "@/lib/family-time";
import { localPath } from "@/lib/suite-menu";

function CardLink({ card, i }: { card: HomeCard; i: number }) {
  const cls = "rise group flex min-h-24 items-center justify-between gap-3 rounded-xl border bg-card p-5 hover:border-primary/40 hover:shadow-md transition-all";
  const body = <><span className="min-w-0 break-words font-display text-xl sm:text-2xl">{card.label}</span><ArrowRight className="h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-1" /></>;
  const local = localPath(card.href);
  return local
    ? <Link href={local} className={cls} style={{ animationDelay: `${i * 50}ms` }} data-testid={`link-card-${card.id}`}>{body}</Link>
    : <a href={card.href} className={cls} style={{ animationDelay: `${i * 50}ms` }} data-testid={`link-card-${card.id}`}>{body}</a>;
}

function FamilyTimeBlock({ ft }: { ft: FamilyTime }) {
  const rows = familyRows(ft);
  const local = localPath(ft.schedulerHref);
  const linkCls = "inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4";
  return (
    <div className="border-t border-dashed pt-5" data-testid="section-family-time">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground"><CalendarDays className="h-4 w-4" /> Family time {ft.year}</p>
        {ft.schedulerHref && (local
          ? <Link href={local} className={linkCls} data-testid="link-scheduler">Scheduler <ArrowRight className="h-3.5 w-3.5" /></Link>
          : <a href={ft.schedulerHref} className={linkCls} data-testid="link-scheduler">Scheduler <ArrowRight className="h-3.5 w-3.5" /></a>)}
      </div>
      {!!rows.length && <ul className="mt-3 grid gap-x-5 gap-y-1.5 xl:grid-cols-4 text-sm leading-6">
        {rows.map((r) => <li key={r.familyGroupId} className="flex items-center gap-2 min-w-0" data-testid={`row-family-${r.familyGroupId}`}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: safeColor(r.displayColor) }} aria-hidden />
          <span className="min-w-0"><span className="font-medium">{r.familyName}</span>{" "}
            <span className="text-muted-foreground whitespace-nowrap">{r.segments.map((s) => formatRange(s)).join(", ")}</span></span>
        </li>)}
      </ul>}
    </div>
  );
}

export default function HomePage() {
  const { data: me } = useSession();
  const home = useGetHome();
  const d = home.data;
  const img = `${import.meta.env.BASE_URL}images/hwd-farm-illustration.jpg`;
  const notice = d?.notice?.text;
  const reminders = d?.reminders ?? [];
  const featuredLine = d?.featuredLine ?? null;
  const familyTime = d?.familyTime ?? null;
  const slideshow = d?.slideshowEmbedUrl?.trim() || null;
  const cards = d?.cards ?? [];
  const hasAnnouncements = !!(featuredLine || notice || reminders.length || familyTime);

  return (
    <div className="space-y-10 md:space-y-12">
      <section className="rise">
        <figure className="relative overflow-hidden rounded-2xl border shadow-lg bg-card">
          <img src={img} alt="Illustration of HWD Farm" className="w-full aspect-[16/9] md:aspect-[21/9] object-cover" data-testid="img-hero" />
        </figure>
        <p className="mt-4 text-base sm:text-lg text-muted-foreground break-words" data-testid="text-greeting">
          Good to see you, {me ? nameOf(me) : ""}.
        </p>
      </section>

      <section className="rounded-2xl border bg-card p-5 md:p-7" data-testid="section-announcements">
        <div className="flex items-end justify-between gap-3 mb-4">
          <h2 className="text-2xl md:text-3xl leading-snug">Announcements</h2>
          <Link href="/announcements" className="text-sm text-primary underline underline-offset-4 shrink-0" data-testid="link-all-announcements">See all</Link>
        </div>
        {home.isLoading ? <div className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> :
          home.isError ? <ErrorState onRetry={() => home.refetch()} /> :
          !hasAnnouncements ? <p className="text-muted-foreground" data-testid="empty-announcements">Nothing new right now.</p> :
          <div className="space-y-5">
            {featuredLine && <p className="flex items-start gap-2 text-lg" data-testid="text-latest-minutes">
              <FileText className="mt-1 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 break-words">{featuredLine.label}{" "}
                <a href={openUrl(featuredLine.document.id)} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4" data-testid="link-latest-minutes">
                  {featuredLine.document.title}<ArrowUpRight className="ml-0.5 inline h-4 w-4" /></a></span>
            </p>}
            {notice && <div className="rounded-xl border-l-4 border-primary bg-accent/50 px-5 py-4" data-testid="notice-home"><NoticeText text={notice} /></div>}
            {!!reminders.length && <div className="space-y-3" data-testid="list-reminders">
              {reminders.map((item) => <article key={item.id} className="rounded-xl border bg-background/50 px-5 py-4" data-testid={`reminder-${item.id}`}>
                <h3 className="text-xl break-words">{item.title}</h3>
                {item.body && <p className="mt-1.5 text-muted-foreground"><NoticeText text={item.body} /></p>}
              </article>)}
            </div>}
            {familyTime && <FamilyTimeBlock ft={familyTime} />}
          </div>}
      </section>

      {slideshow && <section data-testid="section-slideshow">
        <div className="relative w-full overflow-hidden rounded-2xl border bg-card shadow-sm" style={{ aspectRatio: "16 / 9" }}>
          <iframe src={slideshow} title="Family slideshow" loading="lazy" referrerPolicy="no-referrer" allow="" className="absolute inset-0 h-full w-full border-0" data-testid="iframe-slideshow" />
        </div>
      </section>}

      {home.isLoading ? <section className="grid sm:grid-cols-2 gap-4"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></section> :
        !!cards.length && <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-cards">
          {cards.map((c, i) => <CardLink key={c.id} card={c} i={i} />)}
        </section>}
    </div>
  );
}
