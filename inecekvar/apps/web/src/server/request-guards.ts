import type { RequestHandler, Response } from 'express';
import type { WebServerConfig } from './config';
import { renderPath } from './page-cache';

function reject(res: Response, status: number, body: string): void {
  res.status(status).set('Cache-Control', 'no-store').type('text/plain').send(body);
}

export const stripProxyHeaders: RequestHandler = (req, _res, next) => {
  for (const name of Object.keys(req.headers)) {
    if (
      name === 'forwarded' ||
      name.startsWith('x-forwarded-') ||
      ['x-original-url', 'x-rewrite-url', 'x-http-method-override'].includes(name)
    ) {
      delete req.headers[name];
    }
  }
  next();
};

export const methodGuard: RequestHandler = (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.set('Allow', 'GET, HEAD');
    reject(res, 405, 'Method not allowed');
    return;
  }
  next();
};

export const bodyGuard: RequestHandler = (req, res, next) => {
  if (
    (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0') ||
    req.headers['transfer-encoding'] !== undefined
  ) {
    reject(res, 413, 'Request body not allowed');
    return;
  }
  next();
};

export const urlLengthGuard: RequestHandler = (req, res, next) => {
  if (req.originalUrl.length > 2048) {
    reject(res, 414, 'Request URL too long');
    return;
  }
  // Absolute-form targets must not change the renderer's origin.
  if (!req.originalUrl.startsWith('/')) {
    reject(res, 400, 'Bad request');
    return;
  }
  // Network-path (`//host`) and backslash forms never reach rendering, raw or decoded.
  const separator = req.originalUrl.indexOf('?');
  const path = separator < 0 ? req.originalUrl : req.originalUrl.slice(0, separator);
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Undecodable paths are refused later by URL normalization.
  }
  if ([path, decoded].some((value) => value.startsWith('//') || value.includes('\\'))) {
    reject(res, 400, 'Bad request');
    return;
  }
  next();
};

export function hostGuard(config: WebServerConfig): RequestHandler {
  return (req, res, next) => {
    const host = req.headers.host?.toLowerCase();
    const hostCount = req.rawHeaders.filter((name, index) => {
      return index % 2 === 0 && name.toLowerCase() === 'host';
    }).length;
    let hostname: string | undefined;
    if (host && hostCount === 1 && /^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) {
      hostname = host.split(':')[0];
    } else if (
      host &&
      hostCount === 1 &&
      config.env !== 'production' &&
      /^\[::1\](:\d{1,5})?$/.test(host)
    ) {
      hostname = '::1';
    }
    if (!hostname || !config.allowedHosts.includes(hostname)) {
      reject(res, 400, 'Bad request');
      return;
    }
    res.locals['hostname'] = hostname;
    const canonicalHost = new URL(config.canonicalOrigin).hostname.replace(/^\[|\]$/g, '');
    if (config.env === 'production' && hostname !== canonicalHost) {
      const separator = req.originalUrl.indexOf('?');
      const path = separator < 0 ? req.originalUrl : req.originalUrl.slice(0, separator);
      const query = new URLSearchParams(separator < 0 ? '' : req.originalUrl.slice(separator + 1));
      res
        .status(301)
        .set(
          'Location',
          config.canonicalOrigin + renderPath(path, query, config.cacheQueryAllowlist),
        )
        .set('Cache-Control', 'no-store')
        .type('text/plain')
        .send('Moved permanently');
      return;
    }
    next();
  };
}
