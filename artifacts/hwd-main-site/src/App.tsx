import { type ComponentType, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import { AuthGate } from "@/components/auth-gate";
import { AppShell } from "@/components/app-shell";
import { AdminGuard, AdminOnlyGuard } from "@/components/admin/admin-guard";
import SignInPage from "@/pages/sign-in";
import AdminSignInPage from "@/pages/admin-sign-in";
import AuthContinuePage from "@/pages/auth-continue";
import HomePage from "@/pages/home";
import DocumentsPage from "@/pages/documents";
import DocumentGroupPage from "@/pages/document-group";
import { MeetingsRedirect, ShareholdersRedirect, DirectorsRedirect, LoggingRedirect, GoverningRedirect, PhotoArchiveRedirect } from "@/pages/legacy-redirect";
import { AdminHomePage } from "@/pages/admin/admin-home";
import { AdminDuesPage } from "@/pages/admin/admin-dues";
import DuesPage from "@/pages/dues";
import ContactPage from "@/pages/contact";
import { AdminContactPage, AdminSuiteMenuPage } from "@/pages/admin/admin-suite";
import AnnouncementsPage from "@/pages/announcements";
import AdminDocumentsPage from "@/pages/admin/admin-documents";
import { AdminAnnouncementsPage, AdminAuditPage, AdminHomeNoticePage, AdminPeoplePage } from "@/pages/admin/admin-features";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

const admin = (C: ComponentType) => () => <AdminGuard><C /></AdminGuard>;
const adminOnly = (C: ComponentType) => () => <AdminOnlyGuard><C /></AdminOnlyGuard>;

function PrivateRoutes() {
  return (
    <AuthGate>
      <AppShell>
        <RoutedErrorBoundary>
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/documents" component={DocumentsPage} />
            <Route path="/documents/:slug" component={DocumentGroupPage} />
            <Route path="/meetings" component={MeetingsRedirect} />
            <Route path="/meetings/shareholders" component={ShareholdersRedirect} />
            <Route path="/meetings/directors" component={DirectorsRedirect} />
            <Route path="/logging" component={LoggingRedirect} />
            <Route path="/governing" component={GoverningRedirect} />
            <Route path="/photo-archive" component={PhotoArchiveRedirect} />
            <Route path="/announcements" component={AnnouncementsPage} />
            <Route path="/contact" component={ContactPage} />
            <Route path="/dues" component={DuesPage} />
            <Route path="/admin"><Redirect to="/admin/documents" /></Route>
            <Route path="/admin/documents" component={admin(AdminDocumentsPage)} />
            <Route path="/admin/announcements" component={admin(AdminAnnouncementsPage)} />
            <Route path="/admin/home-notice" component={admin(AdminHomeNoticePage)} />
            <Route path="/admin/home" component={adminOnly(AdminHomePage)} />
            <Route path="/admin/dues" component={adminOnly(AdminDuesPage)} />
            <Route path="/admin/apps"><Redirect to="/admin/suite-menu" /></Route>
            <Route path="/admin/suite-menu" component={adminOnly(AdminSuiteMenuPage)} />
            <Route path="/admin/contact" component={adminOnly(AdminContactPage)} />
            <Route path="/admin/people" component={adminOnly(AdminPeoplePage)} />
            <Route path="/admin/audit" component={adminOnly(AdminAuditPage)} />
            <Route component={NotFound} />
          </Switch>
        </RoutedErrorBoundary>
      </AppShell>
    </AuthGate>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/admin/sign-in" component={AdminSignInPage} />
      <Route path="/auth/continue" component={AuthContinuePage} />
      <Route component={PrivateRoutes} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
