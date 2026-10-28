import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";

const TABS = [
  { href: "/admin/documents", label: "Documents" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/home-notice", label: "Home notice" },
  { href: "/admin/home", label: "Home" },
  { href: "/admin/apps", label: "Apps" },
  { href: "/admin/people", label: "People & Access" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminTabs() {
  const [loc] = useLocation();
  const { data: me } = useSession();
  const tabs = me?.role === "admin" ? TABS : TABS.filter((t) => t.href === "/admin/documents" || t.href === "/admin/announcements" || t.href === "/admin/home-notice");
  return (
    <div className="mb-8 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href}
          className={cn("whitespace-nowrap px-4 py-2.5 -mb-px border-b-2 transition-colors",
            (loc === t.href || loc.startsWith(t.href + "/")) ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          data-testid={`link-admin-${t.label.toLowerCase().split(" ")[0]}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
