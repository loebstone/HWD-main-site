type Visit = { pathname: string; search: string; hash: string };
type Entry = (params: { to: string }) => Promise<{ url: string }>;

export const intendedPath = (visit: Visit) => visit.pathname + visit.search + visit.hash;

export async function redirectToSignIn(visit: Visit, entry: Entry, replace: (url: string) => void) {
  const { url } = await entry({ to: intendedPath(visit) });
  replace(url);
}

// Runs before React mounts: anonymous protected-page visits never render an
// intermediate sign-in page, loading skeleton, or private shell.
export async function prepareProtectedVisit(
  visit: Visit, session: () => Promise<unknown>, entry: Entry,
  replace: (url: string) => void,
): Promise<"render" | "redirect"> {
  if (["/sign-in", "/admin/sign-in", "/auth/continue"].includes(visit.pathname)) return "render";
  try {
    await session();
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 401) {
      try {
        await redirectToSignIn(visit, entry, replace);
        return "redirect";
      } catch { /* Render the retry/error UI if sign-in configuration is unavailable. */ }
    }
  }
  return "render";
}
