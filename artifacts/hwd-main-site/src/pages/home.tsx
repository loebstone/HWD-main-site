import { Link } from "wouter";
import { useGetHome } from "@workspace/api-client-react";
import { ArrowRight } from "lucide-react";
import { useSession, nameOf } from "@/lib/session";
import { DocumentCard } from "@/components/document-card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";

const QUICK = [
  { href: "/meetings", label: "Meetings", text: "Shareholders' and directors' minutes, by year" },
  { href: "/governing", label: "Governing Docs & Policies", text: "Bylaws, agreements and house rules" },
  { href: "/logging", label: "Logging", text: "Forestry plans and harvest records" },
  { href: "/photo-archive", label: "Photo Archive", text: "Albums and pictures through the years" },
];

export default function HomePage() {
  const { data: me } = useSession();
  const home = useGetHome();
  const img = `${import.meta.env.BASE_URL}images/hwd-farm-illustration.jpg`;

  return (
    <div className="space-y-14">
      <section className="rise">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Lee, Massachusetts</p>
        <h1 className="mt-2 text-4xl md:text-6xl leading-[1.05]" data-testid="text-greeting">
          Good to see you, {me ? nameOf(me) : ""}.
        </h1>
        <figure className="mt-8 overflow-hidden rounded-2xl border shadow-lg bg-card">
          <img src={img} alt="Illustration of HWD Farm" className="w-full aspect-[16/9] md:aspect-[21/9] object-cover" data-testid="img-hero" />
        </figure>
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
          <h2 className="text-3xl">Recently added</h2>
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
