import { z } from 'zod';

import { appEnvironmentSchema, httpUrlSchema, parseUrl } from './shared.js';

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.localhost')
  );
}

/** A web origin: scheme, host and optional port only, e.g. `https://kadro.app`. */
const webOrigin = z.string().refine((value) => {
  const url = parseUrl(value);
  return (
    url !== null &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.origin === value &&
    value !== 'null'
  );
}, 'must be an origin such as https://kadro.app (no path, no trailing slash)');

/**
 * RevenueCat public SDK keys (ADR-0063): `appl_…` for iOS, `goog_…` for Android. They are public
 * by design (they only identify the app to RevenueCat); the secret REST key never reaches the
 * binary.
 */
const revenueCatPublicKey = (prefix: 'appl' | 'goog') =>
  z
    .string()
    .regex(
      prefix === 'appl' ? /^appl_[A-Za-z0-9]{10,64}$/ : /^goog_[A-Za-z0-9]{10,64}$/,
      `must be a RevenueCat public SDK key (${prefix}_...)`,
    );

/**
 * Public values compiled into the mobile binary. Only `EXPO_PUBLIC_*` keys are allowed here;
 * anything secret belongs on the server. Outside `local`, the API must be served over HTTPS
 * (security checklist item 10).
 *
 * - `EXPO_PUBLIC_WEB_ORIGIN`: origin of the web app; the universal / app link host
 *   (`associatedDomains`, Android intent filters) and the base of shared links (ADR-0045).
 *   Optional locally (no https links are registered); required outside local as a non-loopback
 *   `https://` origin.
 * - `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`: public SDK
 *   keys. Optional in every environment: without the platform's key the paywall reports Pro as
 *   unavailable instead of starting a purchase.
 */
export const mobilePublicEnvSchema = z
  .object({
    EXPO_PUBLIC_APP_ENV: appEnvironmentSchema,
    EXPO_PUBLIC_API_URL: httpUrlSchema,
    EXPO_PUBLIC_WEB_ORIGIN: webOrigin.optional(),
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: revenueCatPublicKey('appl').optional(),
    EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: revenueCatPublicKey('goog').optional(),
  })
  .superRefine((env, ctx) => {
    const local = env.EXPO_PUBLIC_APP_ENV === 'local';
    if (!local && env.EXPO_PUBLIC_WEB_ORIGIN === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['EXPO_PUBLIC_WEB_ORIGIN'],
        message: 'is required outside the local environment',
      });
    }
    if (!local && env.EXPO_PUBLIC_WEB_ORIGIN !== undefined) {
      const origin = parseUrl(env.EXPO_PUBLIC_WEB_ORIGIN);
      if (origin !== null && (origin.protocol !== 'https:' || isLoopbackHost(origin.hostname))) {
        ctx.addIssue({
          code: 'custom',
          path: ['EXPO_PUBLIC_WEB_ORIGIN'],
          message: 'must be a non-loopback https:// origin outside the local environment',
        });
      }
    }

    const url = parseUrl(env.EXPO_PUBLIC_API_URL);
    if (url === null) {
      return;
    }
    if (env.EXPO_PUBLIC_APP_ENV !== 'local' && url.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        path: ['EXPO_PUBLIC_API_URL'],
        message: 'must use https:// outside the local environment',
      });
    }
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
      ctx.addIssue({
        code: 'custom',
        path: ['EXPO_PUBLIC_API_URL'],
        message: 'must not contain credentials, a query string or a fragment',
      });
    }
  });
export type MobilePublicEnv = z.infer<typeof mobilePublicEnvSchema>;
