import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";

const KINDS = [
  { href: "/meetings/shareholders", title: "Shareholders' Meetings", text: "The annual gathering: minutes, notices, financial reports and votes." },
  { href: "/meetings/directors", title: "Directors' Meetings", text: "Board minutes and the papers that went with them." },
];

export default function MeetingsPage() {
  return (
    <>
      <PageHeader eyebrow="Records" title="Meetings" intro="Choose which meetings you're looking for. Each is arranged by year, newest first." />
      <div className="grid md:grid-cols-2 gap-5">
        {KINDS.map((k) => (
          <Link key={k.href} href={k.href} className="rise group rounded-2xl border bg-card p-7 hover:shadow-lg hover:border-primary/40 transition-all"
            data-testid={`link-${k.href.split("/").pop()}`}>
            <span className="font-display text-3xl block">{k.title}</span>
            <span className="mt-2 block text-muted-foreground text-lg">{k.text}</span>
            <span className="mt-6 inline-flex items-center gap-2 text-primary">Open <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
          </Link>
        ))}
      </div>
    </>
  );
}
