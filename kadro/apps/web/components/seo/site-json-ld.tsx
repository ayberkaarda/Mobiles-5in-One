import { loadWebEnv } from '@kadro/config';

import { siteStructuredData } from '../../lib/server/seo/site-structured-data';
import { JsonLd } from './json-ld';

/** `Organization` and `MobileApplication` data block of the home page and `/ozellikler`. */
export async function SiteJsonLd() {
  return <JsonLd data={siteStructuredData(loadWebEnv().WEB_ORIGIN)} />;
}
