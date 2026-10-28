import type { Section } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { DocumentLibrary } from "@/components/document-library";

export function SectionPage({ section, eyebrow, title, intro }: { section: Section; eyebrow: string; title: string; intro: string }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} intro={intro} />
      <DocumentLibrary section={section} emptyText="When an editor adds documents here, they'll appear by year." />
    </>
  );
}

export const ShareholdersPage = () => <SectionPage section="shareholders" eyebrow="Meetings" title="Shareholders' Meetings" intro="Minutes, notices and reports, newest year first." />;
export const DirectorsPage = () => <SectionPage section="directors" eyebrow="Meetings" title="Directors' Meetings" intro="Board minutes and papers, newest year first." />;
export const LoggingPage = () => <SectionPage section="logging" eyebrow="The woods" title="Logging" intro="Forest management plans, harvest records and correspondence." />;
export const GoverningPage = () => <SectionPage section="governing" eyebrow="How we run things" title="Governing Docs & Policies" intro="The agreements and policies that hold the Farm together." />;
export const PhotoArchivePage = () => <SectionPage section="photo_archive" eyebrow="Memory" title="Photo Archive" intro="Albums and collections from over the years." />;
