import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSuiteMenuQueryKey, useGetSuiteMenu, useSignOut } from "@workspace/api-client-react";
import { Eye, LogOut, Menu, X } from "lucide-react";
import { useViewAsMemberSwitch } from "@/lib/view-as-member";
import { useSession, nameOf, canEdit } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { DEFAULT_ITEMS, DEFAULT_TOOLS, localPath, sortItems, visibleSuiteTools } from "@/lib/suite-menu";

type NavEntry = { id: string; label: string; href: string };

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useSession();
  const [location, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const signOut = useSignOut();
  const menu = useGetSuiteMenu({ query: { queryKey: getGetSuiteMenuQueryKey(), staleTime: 60_000, refetchOnMount: true } });

  const items: NavEntry[] = sortItems(menu.data?.items?.length ? menu.data.items : DEFAULT_ITEMS);
  const viewing = me?.viewAsMember === true;
  const { switchMode, switching } = useViewAsMemberSwitch();
  const canViewAsMember = !viewing && me?.role === "admin";
  const tools = viewing ? [] : visibleSuiteTools(me, menu.data?.tools ?? DEFAULT_TOOLS);
  const admin: NavEntry[] = !viewing && canEdit(me) ? [{ id: "admin", label: "Admin", href: "/admin" }] : [];
  const isActive = (path: string) => (path === "/" ? location === "/" : location.startsWith(path));

  async function handleSignOut() {
    try { await signOut.mutateAsync(); } catch { return; }
    qc.clear();
    setLocation("/sign-in?signedOut=1");
  }

  const cls = (active: boolean, mobile: boolean) => cn("rounded-md px-3 py-2 transition-colors hover:bg-muted",
    active ? "text-primary font-medium bg-secondary/70" : "text-muted-foreground hover:text-foreground", mobile && "text-lg py-3");

  const renderLink = (it: NavEntry, mobile: boolean, prefix: string) => {
    const tid = `${prefix}-${it.id}${mobile ? "-mobile" : ""}`;
    if (!it.href) return <span key={it.id} aria-disabled className={cn(cls(false, mobile), "opacity-50 cursor-default hover:bg-transparent")} data-testid={tid}>{it.label}</span>;
    const local = localPath(it.href);
    if (local) return <Link key={it.id} href={local} onClick={() => setOpen(false)} className={cls(isActive(local.split(/[?#]/)[0]), mobile)} data-testid={tid}>{it.label}</Link>;
    return <a key={it.id} href={it.href} className={cls(false, mobile)} data-testid={tid}>{it.label}</a>;
  };

  const links = (mobile: boolean) => <>
    {items.map((it) => renderLink(it, mobile, "link-nav"))}
    {tools.length > 0 && <>
      <span className={cn("text-xs uppercase tracking-[0.18em] text-muted-foreground/80", mobile ? "mt-3 px-3 pt-3 border-t" : "ml-2 self-center pl-3 border-l")} data-testid="text-nav-tools">Tools</span>
      {tools.map((t) => renderLink(t, mobile, "link-tool"))}
    </>}
    {admin.map((it) => <span key="admin" className={cn(!mobile && "ml-auto", mobile && "mt-2 pt-2 border-t flex flex-col")}>{renderLink(it, mobile, "link-nav")}</span>)}
  </>;

  return (
    <div className="min-h-[100dvh] flex flex-col">
      {viewing && <div className="bg-primary text-primary-foreground text-sm" role="status" data-testid="banner-view-as-member">
        <div className="max-w-6xl mx-auto px-5 py-1.5 flex flex-wrap items-center justify-center gap-x-2">
          <span>Viewing as a member</span><span aria-hidden>·</span>
          <button onClick={() => switchMode(false)} disabled={switching} className="underline underline-offset-4 font-medium disabled:opacity-60" data-testid="button-switch-back">{switching ? "Switching…" : "Switch back"}</button>
        </div>
      </div>}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-end gap-2" data-testid="link-brand">
            <Logo />
            <span className="hidden sm:inline pb-0.5 text-xs uppercase tracking-[0.2em] text-muted-foreground">Lee, Mass.</span>
          </Link>
          <div className="hidden lg:flex items-center gap-3 text-sm">
            {canViewAsMember && <button onClick={() => switchMode(true)} disabled={switching}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-60"
              data-testid="button-view-as-member"><Eye className="h-4 w-4" /> {switching ? "Switching…" : "View as member"}</button>}
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
        <nav className="hidden lg:block border-t" data-testid="nav-desktop">
          <div className="max-w-6xl mx-auto px-3 py-1.5 flex flex-wrap gap-1 text-[0.95rem]">{links(false)}</div>
        </nav>
        {open && (
          <nav className="lg:hidden border-t bg-background px-4 py-3 flex flex-col max-h-[calc(100dvh-4rem)] overflow-y-auto" data-testid="nav-mobile">
            {links(true)}
            <div className="mt-3 pt-3 border-t flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 break-words text-muted-foreground">{me ? nameOf(me) : ""}</span>
              {canViewAsMember && <button onClick={() => { setOpen(false); void switchMode(true); }} disabled={switching}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-2" data-testid="button-view-as-member-mobile">
                <Eye className="h-4 w-4" /> View as member</button>}
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
