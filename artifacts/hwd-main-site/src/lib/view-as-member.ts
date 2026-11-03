import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSetViewAsMember } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/session";

/**
 * Switch view-as-member mode. All role-scoped cache is cancelled and cleared so
 * in-flight privileged responses cannot repopulate it. Reload the document after
 * the server commits: mounted query observers may retain data after cache.clear().
 */
export function useViewAsMemberSwitch() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mutation = useSetViewAsMember();
  const [switching, setSwitching] = useState(false);

  async function switchMode(enabled: boolean) {
    if (switching) return;
    setSwitching(true);
    try {
      await qc.cancelQueries();
      await mutation.mutateAsync({ data: { enabled } });
      await qc.cancelQueries();
      qc.clear();
      // A fresh document discards every observer and all privileged DOM state,
      // including mounted Home queries whose keys did not change with the role.
      window.location.replace(import.meta.env.BASE_URL);
    } catch (err) {
      toast({ title: enabled ? "Couldn't switch to member view" : "Couldn't switch back", description: errorMessage(err, "Please try again."), variant: "destructive" });
    } finally {
      setSwitching(false);
    }
  }
  return { switchMode, switching };
}
