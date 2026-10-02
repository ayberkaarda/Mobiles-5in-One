import { loadMobilePublicEnv } from '@kadro/config/mobile';

import { legalLinks } from './legal';

export { pushPort, pushStore } from './push-instance';

const { EXPO_PUBLIC_WEB_ORIGIN: webOrigin } = loadMobilePublicEnv();

/** Legal pages on the configured web origin; empty in local builds without one. */
export const appLegalLinks = legalLinks(webOrigin);
