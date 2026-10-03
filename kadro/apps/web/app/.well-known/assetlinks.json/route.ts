import { loadWebEnv } from '@kadro/config';
import { connection } from 'next/server';

import { assetLinks, wellKnownJson } from '../../../lib/server/app-links';

export const dynamic = 'force-dynamic';

/**
 * Android App Links (ADR-0045, ADR-0058): served as `application/json` without a redirect, only
 * when `ANDROID_CERT_SHA256_FINGERPRINTS` lists at least one fingerprint; otherwise 404.
 */
export async function GET(): Promise<Response> {
  await connection();
  return wellKnownJson(assetLinks(loadWebEnv()));
}
