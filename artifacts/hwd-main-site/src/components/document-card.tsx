import type { Document } from "@workspace/api-client-react";
import { ExternalLink, FileText } from "lucide-react";
import { openUrl } from "@/lib/docs";

export function DocumentCard({ doc }: { doc: Document }) {
  return (
    <div data-testid={`card-document-${doc.id}`}>
      <a href={openUrl(doc.id)} target="_blank" rel="noopener noreferrer"
        className="group flex items-start gap-4 rounded-xl border bg-card px-4 py-4 md:px-5 shadow-xs hover:shadow-md hover:border-primary/40 transition-all"
        data-testid={`link-open-document-${doc.id}`}>
        <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
          {doc.type === "pdf" ? <FileText className="h-5 w-5" /> : <ExternalLink className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg leading-snug group-hover:text-primary transition-colors">{doc.title}</span>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{doc.type === "pdf" ? "PDF" : "Link"}</span>
            {doc.year != null && <span>{doc.year}</span>}
            {doc.tags.map((t) => <span key={t} className="rounded-full bg-muted px-2 text-xs leading-5">{t}</span>)}
          </span>
        </span>
        <span className="hidden sm:block self-center text-sm text-primary opacity-0 group-hover:opacity-100 transition-opacity">Open</span>
      </a>
      {doc.note && <p className="mt-2 px-1 text-[0.95rem] text-muted-foreground whitespace-pre-line" data-testid={`text-note-${doc.id}`}>{doc.note}</p>}
    </div>
  );
}
