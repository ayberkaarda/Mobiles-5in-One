import { loadWebEnv } from '@kadro/config';

import { handleThemePreference } from '../../components/marketing/theme-request';

/**
 * `POST /tema`: stores the colour-scheme preference of the footer toggle in the `kadro-theme`
 * cookie and redirects back with 303 (ADR-0084). Same-origin form posts only; the checks and the
 * safe return path are in `components/marketing/theme-request.ts`. Other methods get 405 from
 * Next.js. The path is on the default `app` surface, so the proxy adds the same headers as to
 * every other page.
 */
export async function POST(request: Request): Promise<Response> {
  return handleThemePreference(request, loadWebEnv().WEB_ORIGIN);
}
