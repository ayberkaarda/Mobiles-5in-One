import { inject, InjectionToken, makeStateKey, TransferState } from '@angular/core';

export interface PublicWebConfig {
  canonicalOrigin: string;
  appOrigin: string;
  tilesOrigin: string | null;
  apiPublicBaseUrl: string;
  appStoreId: string | null;
}

export const PUBLIC_WEB_CONFIG = new InjectionToken<PublicWebConfig>('Public web config');
export const PUBLIC_CONFIG_STATE_KEY = makeStateKey<PublicWebConfig>('iv-public-config');
export const DEFAULT_PUBLIC_WEB_CONFIG: Readonly<PublicWebConfig> = {
  canonicalOrigin: 'https://inecekvar.app',
  appOrigin: 'https://app.inecekvar.app',
  tilesOrigin: null,
  apiPublicBaseUrl: 'https://api.inecekvar.app/v1',
  appStoreId: null,
};

function isPublicConfig(value: unknown): value is PublicWebConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const config = value as Record<string, unknown>;
  if (
    typeof config['canonicalOrigin'] !== 'string' ||
    typeof config['appOrigin'] !== 'string' ||
    !(config['tilesOrigin'] === null || typeof config['tilesOrigin'] === 'string') ||
    typeof config['apiPublicBaseUrl'] !== 'string' ||
    !(
      config['appStoreId'] === null ||
      (typeof config['appStoreId'] === 'string' && /^\d{6,12}$/.test(config['appStoreId']))
    )
  ) {
    return false;
  }
  try {
    const canonical = new URL(config['canonicalOrigin']);
    const api = new URL(config['apiPublicBaseUrl']);
    const app = new URL(config['appOrigin']);
    const tiles = config['tilesOrigin'] === null ? null : new URL(config['tilesOrigin'] as string);
    return (
      ['http:', 'https:'].includes(canonical.protocol) &&
      ['http:', 'https:'].includes(api.protocol) &&
      config['canonicalOrigin'] === canonical.origin &&
      ['http:', 'https:'].includes(app.protocol) &&
      config['appOrigin'] === app.origin &&
      (tiles === null ||
        (['http:', 'https:'].includes(tiles.protocol) && config['tilesOrigin'] === tiles.origin)) &&
      config['apiPublicBaseUrl'] === api.origin + '/v1'
    );
  } catch {
    return false;
  }
}

export function publicWebConfigFactory(): PublicWebConfig {
  const state = inject(TransferState);
  const value: unknown = state.get(PUBLIC_CONFIG_STATE_KEY, { ...DEFAULT_PUBLIC_WEB_CONFIG });
  state.remove(PUBLIC_CONFIG_STATE_KEY);
  return isPublicConfig(value)
    ? {
        canonicalOrigin: value.canonicalOrigin,
        appOrigin: value.appOrigin,
        tilesOrigin: value.tilesOrigin,
        apiPublicBaseUrl: value.apiPublicBaseUrl,
        appStoreId: value.appStoreId,
      }
    : { ...DEFAULT_PUBLIC_WEB_CONFIG };
}
