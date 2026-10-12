export type WebEnv = 'local' | 'test' | 'production';

export interface WebServerConfig {
  env: WebEnv;
  canonicalOrigin: string;
  allowedHosts: readonly string[];
  apiPublicOrigin: string;
  apiPublicBaseUrl: string;
  appStoreId: string | null;
  tilesOrigin: string;
  apiInternalUrl: string;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  cacheMaxBytes: number;
  cacheQueryAllowlist: readonly string[];
  cacheDebugHeader: boolean;
  robotsIndexable: boolean;
}

function origin(value: string, variable: string, env: WebEnv): string {
  try {
    const url = new URL(value);
    if (
      !/^https?:\/\/[^/?#\s]+\/?$/i.test(value) ||
      value.includes('@') ||
      value.includes('\\') ||
      !['http:', 'https:'].includes(url.protocol) ||
      (env === 'production' && url.protocol !== 'https:') ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      value.includes('?') ||
      value.includes('#')
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error(`Invalid ${variable}`);
  }
}

function positiveInteger(value: string | undefined, fallback: number, variable: string): number {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`Invalid ${variable}`);
  }
  return number;
}

export function loadWebServerConfig(
  env: Readonly<Record<string, string | undefined>>,
): WebServerConfig {
  const webEnv: WebEnv =
    env['INECEKVAR_ENV'] === 'local' || env['INECEKVAR_ENV'] === 'test'
      ? env['INECEKVAR_ENV']
      : 'production';
  const canonicalOrigin = origin(
    env['IV_WEB_CANONICAL_ORIGIN'] ?? 'https://inecekvar.app',
    'IV_WEB_CANONICAL_ORIGIN',
    webEnv,
  );
  const canonicalHost = new URL(canonicalOrigin).hostname.replace(/^\[|\]$/g, '');
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
  // The canonical host must not reopen production loopback access.
  if (webEnv === 'production' && loopbackHosts.has(canonicalHost)) {
    throw new Error('Invalid IV_WEB_CANONICAL_ORIGIN');
  }
  const allowedHosts = new Set<string>();
  const hostEntries = env['IV_WEB_ALLOWED_HOSTS'] ?? 'inecekvar.app,www.inecekvar.app';
  for (const entry of hostEntries.split(',')) {
    const authority = entry.trim().toLowerCase();
    let host: string;
    if (/^\[::1\](:\d{1,5})?$/.test(authority) || authority === '::1') {
      host = '::1';
    } else if (/^[a-z0-9.-]+(:\d{1,5})?$/.test(authority)) {
      host = authority.replace(/:\d+$/, '');
    } else {
      continue;
    }
    if (webEnv === 'production' && (loopbackHosts.has(host) || host === '*')) {
      continue;
    }
    if (/^[a-z0-9.-]+$/.test(host) || (webEnv !== 'production' && host === '::1')) {
      allowedHosts.add(host);
    }
  }
  if (webEnv !== 'production') {
    allowedHosts.add('localhost');
    allowedHosts.add('127.0.0.1');
  }
  allowedHosts.add(canonicalHost);

  const apiInternalUrl = env['IV_WEB_API_INTERNAL_URL'] ?? 'http://127.0.0.1:57800/v1';
  try {
    const url = new URL(apiInternalUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
  } catch {
    throw new Error('Invalid IV_WEB_API_INTERNAL_URL');
  }

  const cacheTtlSeconds = positiveInteger(
    env['IV_WEB_CACHE_TTL_SECONDS'],
    600,
    'IV_WEB_CACHE_TTL_SECONDS',
  );
  if (!Number.isSafeInteger(cacheTtlSeconds * 1000)) {
    throw new Error('Invalid IV_WEB_CACHE_TTL_SECONDS');
  }

  const apiPublicOrigin = origin(
    env['IV_WEB_API_PUBLIC_ORIGIN'] ?? 'https://api.inecekvar.app',
    'IV_WEB_API_PUBLIC_ORIGIN',
    webEnv,
  );
  const appStoreId = env['IV_WEB_IOS_APP_ID'];

  return {
    env: webEnv,
    canonicalOrigin,
    allowedHosts: [...allowedHosts],
    apiPublicOrigin,
    apiPublicBaseUrl: apiPublicOrigin + '/v1',
    appStoreId: appStoreId !== undefined && /^\d{6,12}$/.test(appStoreId) ? appStoreId : null,
    tilesOrigin: origin(
      env['IV_WEB_TILES_ORIGIN'] ?? 'https://tiles.inecekvar.app',
      'IV_WEB_TILES_ORIGIN',
      webEnv,
    ),
    apiInternalUrl,
    cacheTtlMs: cacheTtlSeconds * 1000,
    cacheMaxEntries: positiveInteger(
      env['IV_WEB_CACHE_MAX_ENTRIES'],
      500,
      'IV_WEB_CACHE_MAX_ENTRIES',
    ),
    cacheMaxBytes: 32 * 1024 * 1024,
    cacheQueryAllowlist: [
      ...new Set(
        (env['IV_WEB_CACHE_QUERY_ALLOWLIST'] ?? 'sayfa')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ],
    cacheDebugHeader: webEnv !== 'production',
    robotsIndexable: webEnv === 'production',
  };
}
