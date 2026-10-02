/**
 * Reads the CSRF double-submit cookie (ADR-0014) from a `document.cookie` string. A name that
 * appears more than once (cookie tossing) or a value outside base64url yields `null`, matching
 * the server's `readCookie` rule. This module only reads; the pages never write cookies.
 */
export function readCookieValue(cookieHeader: string, name: string): string | null {
  const values: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      values.push(part.slice(separator + 1).trim());
    }
  }
  if (values.length !== 1) {
    return null;
  }
  const value = values[0] ?? '';
  return /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;
}

/** "8 Ekim 2026 21:30" in Turkey's time zone, or `null` for an unusable timestamp. */
export function formatGraceUntil(iso: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    return null;
  }
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Istanbul',
  }).format(time);
}

/** `graceUntil` of a `DELETE me` 202 body, when present. */
export function graceUntilFrom(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('graceUntil' in body)) {
    return null;
  }
  const value = (body as { graceUntil: unknown }).graceUntil;
  return typeof value === 'string' ? formatGraceUntil(value) : null;
}
