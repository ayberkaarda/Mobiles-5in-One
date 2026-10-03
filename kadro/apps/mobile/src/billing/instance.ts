import { loadMobilePublicEnv } from '@kadro/config/mobile';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

import { session } from '../api/instance';
import { type BillingPort, unavailableBillingPort } from './port';
import { createPurchasesPort, type PurchasesSdk } from './purchases-port';

const env = loadMobilePublicEnv();

function platformKey(): string | undefined {
  if (Platform.OS === 'ios') {
    return env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
  }
  return Platform.OS === 'android' ? env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY : undefined;
}

const apiKey = platformKey();

/**
 * The app's billing port: RevenueCat when this platform's public SDK key is configured, a closed
 * port otherwise (the paywall then says that Pro is unavailable in this build).
 */
export const billing: BillingPort =
  apiKey === undefined || apiKey === ''
    ? unavailableBillingPort
    : createPurchasesPort({ sdk: Purchases as unknown as PurchasesSdk, apiKey });

// The store customer belongs to one sign-in; any sign-out (user, expiry, deletion) ends it.
session.onSignOut(() => {
  void billing.logOut().catch(() => undefined);
});
