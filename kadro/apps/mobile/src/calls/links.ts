/**
 * Routes of the open-call screens. They live under `ilan/`, not under `eksik-var/`: the path
 * `/eksik-var/<il>/<ilce>` is the district link of the app-link set (ADR-0045), so a call or a
 * match segment there would make those links ambiguous.
 */
export const CALLS_HOME = '/eksik-var';

export function callHref(callId: string): string {
  return `/ilan/${encodeURIComponent(callId)}`;
}

export function matchCallHref(matchId: string): string {
  return `/ilan/mac/${encodeURIComponent(matchId)}`;
}
