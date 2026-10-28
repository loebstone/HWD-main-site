import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetOldSiteImportQueryKey, getListDocumentsQueryKey, getListAnnouncementsQueryKey, getGetHomeQueryKey,
  useGetOldSiteImport, useStartOldSiteImport,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/session";

export function OldSiteImportPanel() {
  const client = useQueryClient();
  const query = useGetOldSiteImport({ query: {
    refetchInterval: q => q.state.data?.status === "running" ? 1500 : false,
  } });
  const mutation = useStartOldSiteImport();
  const run = query.data || null;
  const busy = mutation.isPending || run?.status === "running";
  useEffect(() => {
    if (run?.status === "completed" && !run.dryRun) {
      void client.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      void client.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetHomeQueryKey() });
    }
  }, [run?.id, run?.status, run?.dryRun, client]);
  function start(dryRun: boolean) {
    if (!dryRun && !window.confirm("Import the current old-site index into this site? New PDFs will be stored privately. Previously imported sheet ids will not be duplicated.")) return;
    mutation.mutate({ data: { dryRun } }, { onSuccess: data => {
      client.setQueryData(getGetOldSiteImportQueryKey(), data);
      void query.refetch();
    } });
  }
  return <section className="mb-8 rounded-xl border bg-card p-5" data-testid="old-site-import-panel">
    <h2 className="font-display text-2xl">Import from old site</h2>
    <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
      Read the current published index afresh each time. Dry run checks rows without fetching any files.
      Import saves PDFs privately and skips sheet ids already imported, including retired records.
    </p>
    <div className="mt-4 flex flex-wrap gap-3">
      <Button variant="outline" disabled={busy || query.isLoading} onClick={() => start(true)} data-testid="button-import-dry-run">Dry run</Button>
      <Button disabled={busy || query.isLoading} onClick={() => start(false)} data-testid="button-import-execute">Import</Button>
    </div>
    {(mutation.isError || query.isError) && <p role="alert" className="mt-3 text-sm text-destructive">
      {errorMessage(mutation.error ?? query.error, "Could not load or start the import. Please retry.")}
    </p>}
    {run && <div className="mt-5" aria-live="polite">
      <p className="text-sm" data-testid="import-run-status">
        {run.dryRun ? "Dry run" : "Import"} · {run.status} · {new Date(run.startedAt).toLocaleString()} · {run.actorName}
        {run.status === "running" && ` · ${run.rows.length} of ${run.totalRows || "…"} rows processed`}
      </p>
      {run.dryRun && <p className="mt-1 text-sm text-muted-foreground">“Would import” does not verify file availability or PDF contents.</p>}
      {run.error && <p className="mt-2 text-sm text-destructive" role="alert">{run.error}</p>}
      {!!run.rows.length && <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[650px] text-left text-sm" data-testid="import-report-table">
          <thead><tr className="border-b">
            {["Sheet id", "Title", "Section", "Result", "Reason"].map(label => <th key={label} className="p-2 font-medium">{label}</th>)}
          </tr></thead>
          <tbody>{run.rows.map((row, i) => <tr key={`${row.sheetId}-${i}`} className="border-b align-top">
            <td className="max-w-[220px] break-words p-2 font-mono text-xs">{row.sheetId || "(missing)"}</td>
            <td className="p-2">{row.title}</td><td className="p-2">{row.section}</td>
            <td className={row.result === "failed" ? "p-2 text-destructive" : "p-2"}>{row.result}</td>
            <td className="max-w-md p-2 text-muted-foreground">{row.reason}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </div>}
  </section>;
}
