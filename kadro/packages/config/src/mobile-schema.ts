import { z } from 'zod';

import { appEnvironmentSchema, httpUrlSchema, parseUrl } from './shared.js';

/**
 * Public values compiled into the mobile binary. Only `EXPO_PUBLIC_*` keys are allowed here;
 * anything secret belongs on the server. Outside `local`, the API must be served over HTTPS
 * (security checklist item 10).
 */
export const mobilePublicEnvSchema = z
  .object({
    EXPO_PUBLIC_APP_ENV: appEnvironmentSchema,
    EXPO_PUBLIC_API_URL: httpUrlSchema,
  })
  .superRefine((env, ctx) => {
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
