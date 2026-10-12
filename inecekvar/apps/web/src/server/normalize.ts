import type { RequestHandler } from 'express';
import { renderPath } from './page-cache';

/** Every rendered page lives on a path of lower-case slug segments (or `/`). */
const CANONICAL_PATH = /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

export type TargetVerdict =
  { kind: 'serve' } | { kind: 'redirect'; location: string } | { kind: 'reject' };

/**
 * A request target is served only in its canonical form: a non-canonical spelling that decodes to
 * a plain slug path is redirected once, anything else (matrix parameters, `~`, dots, encoded
 * separators, non-ASCII) is refused so it can neither render nor create a cache entry.
 */
export function classifyTarget(target: string, allowlist: readonly string[]): TargetVerdict {
  const separator = target.indexOf('?');
  const original = separator < 0 ? target : target.slice(0, separator);
  if (!original.startsWith('/') || original.startsWith('//')) return { kind: 'reject' };
  let decoded: string;
  try {
    decoded = decodeURIComponent(original);
  } catch {
    return { kind: 'reject' };
  }
  const path = (decoded.replace(/\/+$/, '') || '/').toLowerCase();
  if (path !== '/' && !CANONICAL_PATH.test(path)) return { kind: 'reject' };
  const query = new URLSearchParams(separator < 0 ? '' : target.slice(separator + 1));
  const pages = query.getAll('sayfa');
  const firstPage =
    /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/hatlar$/.test(path) && pages.length === 1 && pages[0] === '1';
  if (firstPage) query.delete('sayfa');
  if (path === original && !firstPage) return { kind: 'serve' };
  return { kind: 'redirect', location: renderPath(path, query, allowlist) };
}

export function normalizeUrls(allowlist: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const verdict = classifyTarget(req.originalUrl, allowlist);
    if (verdict.kind === 'serve') {
      next();
      return;
    }
    if (verdict.kind === 'reject') {
      res.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Sayfa bulunamadı');
      return;
    }
    res
      .status(301)
      .set('Location', verdict.location)
      .set('Cache-Control', 'public, max-age=3600')
      .type('text/plain')
      .send('Moved permanently');
  };
}
