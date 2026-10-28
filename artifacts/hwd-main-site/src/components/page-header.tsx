import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, intro, children }: { eyebrow?: string; title: string; intro?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rise mb-8 md:mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow && <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground mb-2">{eyebrow}</p>}
        <h1 className="text-3xl md:text-4xl leading-snug break-words text-foreground" data-testid="text-page-title">{title}</h1>
        {intro && <p className="mt-3 text-lg text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </div>
  );
}
