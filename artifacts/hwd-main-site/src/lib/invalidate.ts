import type { QueryClient } from "@tanstack/react-query";

const PREFIXES = ["/api/documents", "/api/groups", "/api/home", "/api/admin/home"];

/** Refresh every document, group and home query after a save. */
export function invalidateDocs(qc: QueryClient) {
  return qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return typeof k === "string" && PREFIXES.some((p) => k.startsWith(p));
    },
  });
}
