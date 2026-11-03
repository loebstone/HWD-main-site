import { useGetDues } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { ErrorState, ListSkeleton } from "@/components/states";
import { NoticeText } from "@/components/notice-text";

export default function DuesPage() {
  const dues = useGetDues();
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Shareholders" title="Dues" />
      {dues.isLoading ? <ListSkeleton rows={2} /> : dues.isError || !dues.data ? <ErrorState onRetry={() => dues.refetch()} /> :
        dues.data.seasonOpen && dues.data.text.trim() ?
          <section className="rounded-2xl border-l-4 border-primary border bg-card px-6 py-6 text-lg leading-relaxed" data-testid="text-dues">
            <NoticeText text={dues.data.text} />
          </section> :
          <section className="rounded-2xl border bg-card px-6 py-10 text-center" data-testid="text-dues-closed">
            <p className="font-display text-2xl">{dues.data.seasonOpen ? "Dues instructions are coming soon." : "Dues season is closed."}</p>
            <p className="mt-2 text-muted-foreground">{dues.data.seasonOpen ? "Please check back for payment details." : "Details will be posted here when the next season opens."}</p>
          </section>}
    </div>
  );
}
