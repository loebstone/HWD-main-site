export const AUDITED_DEVELOPMENT_HOPS = 3;

export function resolveProxyTrust(raw: string | undefined) {
  if (raw === undefined) {
    return { hops: AUDITED_DEVELOPMENT_HOPS, source: "default", reason: "TRUSTED_PROXY_HOPS is unset; using audited development depth" };
  }
  const trimmed = raw.trim();
  const hops = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || !Number.isInteger(hops) || hops < 0 || hops > 8) {
    return { hops: AUDITED_DEVELOPMENT_HOPS, source: "default", reason: "TRUSTED_PROXY_HOPS is invalid; expected integer 0–8; using audited development depth" };
  }
  return { hops, source: "environment", reason: "TRUSTED_PROXY_HOPS is a valid configured integer 0–8" };
}

// Read once at process startup, not at build time and not from request input.
export const PROXY_TRUST = resolveProxyTrust(process.env.TRUSTED_PROXY_HOPS);
