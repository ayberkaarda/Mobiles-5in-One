import type { RequestHandler, Response } from 'express';
import type { HelmetOptions } from 'helmet';
import type { WebServerConfig } from './config';
import { createNonce } from './csp-nonce';

export const PERMISSIONS_POLICY = 'geolocation=(self), camera=(), microphone=()';

export function nonceMiddleware(): RequestHandler {
  return (_req, res, next) => {
    res.locals['cspNonce'] = createNonce();
    next();
  };
}

export function helmetOptions(config: WebServerConfig): HelmetOptions {
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", (_req, res) => `'nonce-${(res as Response).locals['cspNonce']}'`],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", (_req, res) => `'nonce-${(res as Response).locals['cspNonce']}'`],
        'img-src': ["'self'", 'data:', config.tilesOrigin],
        'font-src': ["'self'"],
        'connect-src': [
          "'self'",
          config.apiPublicOrigin,
          config.tilesOrigin,
          ...(config.env === 'production' ? [] : ['ws://localhost:*', 'ws://127.0.0.1:*']),
        ],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'manifest-src': ["'self'"],
        ...(config.env === 'production' ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' },
    // Tile images do not opt into cross-origin isolation.
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    xContentTypeOptions: true,
    xPoweredBy: false,
  };
}
