import { loadWebEnv } from '@kadro/config';
import { connection } from 'next/server';

import { appleAppSiteAssociation, wellKnownJson } from '../../../lib/server/app-links';

export const dynamic = 'force-dynamic';

/**
 * Apple universal links (ADR-0045, ADR-0058): served at the exact path without an extension or a
 * redirect, as `application/json`, only when `APPLE_TEAM_ID` is configured; otherwise 404.
 */
export async function GET(): Promise<Response> {
  await connection();
  return wellKnownJson(appleAppSiteAssociation(loadWebEnv()));
}
