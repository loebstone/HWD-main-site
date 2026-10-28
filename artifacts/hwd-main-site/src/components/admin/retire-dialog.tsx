import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRetireDocument, type Document } from "@workspace/api-client-react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/session";
import { invalidateDocs } from "@/lib/invalidate";

export function RetireDialog({ doc, onClose }: { doc: Document | null; onClose: () => void }) {
  const retire = useRetireDocument();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!doc) return;
    setError(null);
    try {
      await retire.mutateAsync({ id: doc.id });
      await invalidateDocs(qc);
      toast({ title: "Retired", description: doc.title });
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't retire it. Try again."));
    }
  }

  return (
    <AlertDialog open={!!doc} onOpenChange={(o) => { if (!o && !retire.isPending) { setError(null); onClose(); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl">Retire this document?</AlertDialogTitle>
          <AlertDialogDescription>
            "{doc?.title}" will no longer appear for members. It stays on record and can be seen here with retired items shown.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={retire.isPending}>Keep it</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={retire.isPending} data-testid="button-confirm-retire">
            {retire.isPending ? "Retiring..." : "Retire"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
