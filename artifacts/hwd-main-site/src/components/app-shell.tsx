import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetAppLinks, useSignOut } from "@workspace/api-client-react";
import { ArrowUpRight, LogOut, Menu, X } from "lucide-react";
import { useSession, nameOf, canEdit } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Documents", href: "/documents" },
  { label: "Calendar", href: "/calendar-link", external: true },
  { label: "Announcements", href: "/announcements" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useSession();
  const [location, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const signOut = useSignOut();
  const { data: apps } = useGetAppLinks();
  const calendarUrl = apps?.find((app) => app.id === "calendar")?.url;

  const items = canEdit(me) ? [...NAV, { label: "Admin", href: "/admin" }] : NAV;
  const isActive = (href: string) => (href === "/" ? location === "/" : location.startsWith(href));

  async function handleSignOut() {
    try { await signOut.mutateAsync(); } catch { return; }
    qc.clear();
    setLocation("/sign-in?signedOut=1");
  }

  const links = (mobile: boolean) =>
    items.map((it) =>
      "external" in it && it.external ? (
        <a key={it.label} href={calendarUrl || undefined}
          aria-disabled={!calendarUrl} onClick={(event) => { if (!calendarUrl) event.preventDefault(); }}
          className={cn("inline-flex items-center gap-1 rounded-md px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors", mobile && "text-lg py-3")}
          data-testid="link-nav-calendar">
          {it.label}{calendarUrl && <ArrowUpRight className="h-3.5 w-3.5" />}
        </a>
      ) : (
        <Link key={it.label} href={it.href} onClick={() => setOpen(false)}
          className={cn("rounded-md px-3 py-2 transition-colors hover:bg-muted",
            isActive(it.href) ? "text-primary font-medium bg-secondary/70" : "text-muted-foreground hover:text-foreground",
            mobile && "text-lg py-3")}
          data-testid={`link-nav-${it.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
          {it.label}
        </Link>
      ),
    );

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-baseline gap-2" data-testid="link-brand">
            <span className="font-display text-2xl font-semibold text-primary">HWD Farm</span>
            <span className="hidden sm:inline text-xs uppercase tracking-[0.2em] text-muted-foreground">Lee, Mass.</span>
          </Link>
          <div className="hidden lg:flex items-center gap-3 text-sm">
            <span className="text-muted-foreground" data-testid="text-user-name">{me ? nameOf(me) : ""}</span>
            <button onClick={handleSignOut} disabled={signOut.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 hover:bg-muted transition-colors"
              data-testid="button-sign-out">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
          <button className="lg:hidden p-2 -mr-2 rounded-md hover:bg-muted" onClick={() => setOpen((o) => !o)}
            aria-label="Menu" aria-expanded={open} data-testid="button-menu">
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        <nav className="hidden lg:block border-t">
          <div className="max-w-6xl mx-auto px-3 py-1.5 flex flex-wrap gap-1 text-[0.95rem]">{links(false)}</div>
        </nav>
        {open && (
          <nav className="lg:hidden border-t bg-background px-4 py-3 flex flex-col">
            {links(true)}
            <div className="mt-3 pt-3 border-t flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 break-words text-muted-foreground">{me ? nameOf(me) : ""}</span>
              <button onClick={handleSignOut} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-2"
                data-testid="button-sign-out-mobile">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </nav>
        )}
      </header>
      <main className="flex-1 w-full max-w-6xl mx-auto px-5 py-8 md:py-12">{children}</main>
      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-5 py-6 text-sm text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>HWD Farm, Lee, Massachusetts</span>
          <span>For the family. Please don't share links outside it.</span>
        </div>
      </footer>
    </div>
  );
}
