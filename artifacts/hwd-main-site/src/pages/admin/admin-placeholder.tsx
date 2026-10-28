import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { AdminTabs } from "@/components/admin/admin-tabs";

export function AdminPlaceholder({ title, text }: { title: string; text: string }) {
  return (
    <>
      <PageHeader eyebrow="Admin" title={title} />
      <AdminTabs />
      <EmptyState title="Coming later">{text}</EmptyState>
    </>
  );
}

export const AdminAnnouncementsPage = () => <AdminPlaceholder title="Announcements" text="Posting announcements isn't available yet." />;
export const AdminPeoplePage = () => <AdminPlaceholder title="People & Access" text="Managing editor and admin access isn't available here yet." />;
