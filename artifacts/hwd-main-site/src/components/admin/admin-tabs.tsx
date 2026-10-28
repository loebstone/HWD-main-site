import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/documents", label: "Documents" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/people", label: "People & Access" },
];

export function AdminTabs() {
  const [loc] = useLocation();
  return (
    <div className="mb-8 flex gap-1 overflow-x-auto border-b">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href}
          className={cn("whitespace-nowrap px-4 py-2.5 -mb-px border-b-2 transition-colors",
            loc.startsWith(t.href) ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-testid={`link-admin-${t.label.toLowerCase().split(" ")[0]}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
