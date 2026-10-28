import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";

export default function AnnouncementsPage() {
  return (
    <>
      <PageHeader eyebrow="News" title="Announcements" />
      <EmptyState title="No announcements yet">
        This is where Farm news will be posted. The announcements board is still being set up.
      </EmptyState>
    </>
  );
}
