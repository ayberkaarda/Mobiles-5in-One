import { createHash } from 'node:crypto';

/**
 * Have I Been Pwned "Pwned Passwords" range API with k-anonymity: only the first five hex
 * characters of the password's SHA-1 leave the server; the suffix is matched locally. Requests ask
 * for padded responses so the response size does not reveal the prefix's bucket size.
 */
export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

export type BreachCheckResult =
  | { status: 'clean' }
  | { status: 'breached'; occurrences: number }
  /** The service could not be asked or answered unusably; the caller decides (fail open). */
  | { status: 'unavailable'; reason: 'network' | 'timeout' | 'http_status' | 'malformed' };

export type PasswordBreachChecker = (password: string) => Promise<BreachCheckResult>;

/** Minimal `fetch` shape the checker needs; inject a stub in tests. */
export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface BreachCheckerOptions {
  fetch: FetchLike;
  /** Upper bound for one lookup; the result is `unavailable` after it. Default 1 500 ms. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1_500;
const SUFFIX_LINE = /^([0-9A-F]{35}):(\d+)$/;

/** Uppercase hex SHA-1 split into the 5-character range prefix and the 35-character suffix. */
export function sha1RangeParts(password: string): { prefix: string; suffix: string } {
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  return { prefix: digest.slice(0, 5), suffix: digest.slice(5) };
}

/**
 * Parses a range response body. Padding entries carry a count of 0 and never match. Returns
 * `null` when a non-empty line does not have the documented `SUFFIX:COUNT` shape or when the body
 * has no entries at all: a real (padded) range response is never empty, so an empty 200 is an
 * outage, not a clean result.
 */
export function findSuffixCount(body: string, suffix: string): number | null {
  let found = 0;
  let entries = 0;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const match = SUFFIX_LINE.exec(line.toUpperCase());
    if (match === null) {
      return null;
    }
    entries += 1;
    if (match[1] === suffix) {
      found = Number(match[2]);
    }
  }
  return entries === 0 ? null : found;
}

export function createBreachChecker(options: BreachCheckerOptions): PasswordBreachChecker {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers: Record<string, string> = { 'Add-Padding': 'true' };

  return async (password) => {
    const { prefix, suffix } = sha1RangeParts(password);
    const signal = AbortSignal.timeout(timeoutMs);
    let body: string;
    try {
      const response = await options.fetch(`${HIBP_RANGE_URL}${prefix}`, {
        method: 'GET',
        headers,
        signal,
      });
      if (!response.ok) {
        return { status: 'unavailable', reason: 'http_status' };
      }
      body = await response.text();
    } catch {
      return { status: 'unavailable', reason: signal.aborted ? 'timeout' : 'network' };
    }
    const occurrences = findSuffixCount(body, suffix);
    if (occurrences === null) {
      return { status: 'unavailable', reason: 'malformed' };
    }
    return occurrences > 0 ? { status: 'breached', occurrences } : { status: 'clean' };
  };
}
