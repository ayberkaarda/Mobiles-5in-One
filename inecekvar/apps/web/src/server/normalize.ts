import type { RequestHandler } from 'express';
import { renderPath } from './page-cache';

export function normalizedLocation(target: string, allowlist: readonly string[]): string | null {
  const separator = target.indexOf('?');
  const original = separator < 0 ? target : target.slice(0, separator);
  // Keep asset names intact and never emit a network-path reference.
  if (
    original === '/' ||
    !original.startsWith('/') ||
    original.startsWith('//') ||
    original.includes('\\') ||
    /[.]/.test(original)
  )
    return null;
  let path = original.replace(/\/+$/, '') || '/';
  if (/^[A-Za-z0-9\-/]+$/.test(path)) path = path.toLowerCase();
  const query = new URLSearchParams(separator < 0 ? '' : target.slice(separator + 1));
  const pages = query.getAll('sayfa');
  const firstPage =
    /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/hatlar$/.test(path) && pages.length === 1 && pages[0] === '1';
  if (firstPage) query.delete('sayfa');
  if (path === original && !firstPage) return null;
  return renderPath(path, query, allowlist);
}

export function normalizeUrls(allowlist: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const location = normalizedLocation(req.originalUrl, allowlist);
    if (location === null) {
      next();
      return;
    }
    res
      .status(301)
      .set('Location', location)
      .set('Cache-Control', 'public, max-age=3600')
      .type('text/plain')
      .send('Moved permanently');
  };
}
