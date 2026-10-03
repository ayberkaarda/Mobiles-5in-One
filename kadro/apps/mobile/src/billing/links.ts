/**
 * Store pages the paywall and the settings link to. They are the stores' own standard pages (the
 * platform subscription settings and terms), not Kadro pages.
 */
export type StorePlatform = 'ios' | 'android';

const IOS_SUBSCRIPTIONS = 'https://apps.apple.com/account/subscriptions';
const ANDROID_SUBSCRIPTIONS = 'https://play.google.com/store/account/subscriptions';

/** Apple's standard licensed application end user licence agreement and the Play terms. */
const IOS_TERMS = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const ANDROID_TERMS = 'https://play.google.com/about/play-terms/';

function platformOf(os: string): StorePlatform | null {
  return os === 'ios' || os === 'android' ? os : null;
}

/** The page where the store account manages its subscriptions: the SDK's URL when it gave one. */
export function manageSubscriptionUrl(sdkUrl: string | null, os: string): string | null {
  if (sdkUrl !== null && /^https:\/\//.test(sdkUrl)) {
    return sdkUrl;
  }
  const platform = platformOf(os);
  if (platform === null) {
    return null;
  }
  return platform === 'ios' ? IOS_SUBSCRIPTIONS : ANDROID_SUBSCRIPTIONS;
}

export function storeTermsUrl(os: string): string | null {
  const platform = platformOf(os);
  if (platform === null) {
    return null;
  }
  return platform === 'ios' ? IOS_TERMS : ANDROID_TERMS;
}
