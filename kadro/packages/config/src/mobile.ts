import { parseEnv } from './parse.js';
import { type MobilePublicEnv, mobilePublicEnvSchema } from './mobile-schema.js';
import { type EnvSource } from './shared.js';

export { EnvValidationError, type EnvIssue } from './parse.js';
export { mobilePublicEnvSchema, type MobilePublicEnv } from './mobile-schema.js';

export function parseMobilePublicEnv(source: EnvSource): MobilePublicEnv {
  return parseEnv('mobile', mobilePublicEnvSchema, source);
}

/**
 * Reads the public mobile configuration. Each key is accessed statically so the Expo bundler
 * can inline the `EXPO_PUBLIC_*` values at build time; no other variables reach the binary.
 */
export function loadMobilePublicEnv(): MobilePublicEnv {
  return parseMobilePublicEnv({
    EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_WEB_ORIGIN: process.env.EXPO_PUBLIC_WEB_ORIGIN,
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
    EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
  });
}
