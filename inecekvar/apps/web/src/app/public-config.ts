import { inject, InjectionToken, makeStateKey, TransferState } from '@angular/core';

export interface PublicWebConfig {
  canonicalOrigin: string;
  apiPublicBaseUrl: string;
  appStoreId: string | null;
}

export const PUBLIC_WEB_CONFIG = new InjectionToken<PublicWebConfig>('Public web config');
export const PUBLIC_CONFIG_STATE_KEY = makeStateKey<PublicWebConfig>('iv-public-config');
export const DEFAULT_PUBLIC_WEB_CONFIG: Readonly<PublicWebConfig> = {
  canonicalOrigin: 'https://inecekvar.app',
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
    return (
      ['http:', 'https:'].includes(canonical.protocol) &&
      ['http:', 'https:'].includes(api.protocol) &&
      config['canonicalOrigin'] === canonical.origin &&
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
        apiPublicBaseUrl: value.apiPublicBaseUrl,
        appStoreId: value.appStoreId,
      }
    : { ...DEFAULT_PUBLIC_WEB_CONFIG };
}
