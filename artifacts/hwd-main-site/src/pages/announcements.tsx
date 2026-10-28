import { useState } from "react";
import { useListAnnouncements } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";

export default function AnnouncementsPage() {
  const [showPast, setShowPast] = useState(false);
  const query = useListAnnouncements({ showPast });
  return <div className="space-y-7">
    <PageHeader eyebrow="From the family" title="Announcements" intro="News and updates from around the Farm." />
    <div className="flex justify-end">
      <Button variant={showPast ? "secondary" : "outline"} onClick={() => setShowPast((v) => !v)} data-testid="button-toggle-past">
        {showPast ? "Showing past announcements" : "Show past"}
      </Button>
    </div>
    {query.isLoading ? <ListSkeleton rows={4} /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> :
      !query.data?.length ? <EmptyState title={showPast ? "No past announcements" : "No current announcements"}>New notes from the family will appear here.</EmptyState> :
        <div className="space-y-4" data-testid="list-announcements">{query.data.map((item) =>
          <article key={item.id} className="rounded-xl border bg-card p-5 md:p-6" data-testid={`announcement-${item.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl">{item.title}</h2>
              <time className="text-sm text-muted-foreground" dateTime={item.date}>{new Date(item.date).toLocaleDateString()}</time>
            </div>
            <p className="mt-3 whitespace-pre-wrap">{item.body}</p>
            <p className="mt-4 text-sm text-muted-foreground">Posted by {item.createdByName}</p>
          </article>)}</div>}
  </div>;
}
