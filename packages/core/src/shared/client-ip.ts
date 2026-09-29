/**
 * The address the nearest trusted proxy saw. Each proxy appends the address it received the
 * request from, so only entries from the right are trustworthy: with `hops` proxies the client
 * is `hops` places from the end. Entries further left are whatever the client sent.
 */
export function clientIp(forwardedFor: string | null, hops: number): string | undefined {
  if (hops < 1 || !forwardedFor) return undefined;
  const parts = forwardedFor
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - hops] || undefined;
}
