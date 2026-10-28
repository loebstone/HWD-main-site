import { useGetSession, getGetSessionQueryKey, type Identity } from "@workspace/api-client-react";

export function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status;
    return typeof s === "number" ? s : undefined;
  }
  return undefined;
}

export function useSession() {
  return useGetSession({
    query: {
      queryKey: getGetSessionQueryKey(),
      retry: (count, err) => errorStatus(err) !== 401 && errorStatus(err) !== 403 && count < 2,
      staleTime: 60_000,
    },
  });
}

export function nameOf(identity: Identity) {
  return identity.goesBy?.trim() || identity.displayName;
}

export function canEdit(identity: Identity | undefined) {
  return identity?.role === "editor" || identity?.role === "admin";
}

export function errorMessage(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "data" in err) {
    const d = (err as { data: unknown }).data;
    if (d && typeof d === "object" && "error" in d && typeof (d as { error: unknown }).error === "string") return (d as { error: string }).error;
  }
  return fallback;
}
