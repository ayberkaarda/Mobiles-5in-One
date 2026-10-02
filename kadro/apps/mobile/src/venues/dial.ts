import { Linking } from 'react-native';

/**
 * Opens the phone app with a `tel:` link built by `telHref`. A device without a dialer (tablet)
 * rejects it; the number stays visible and selectable on the screen, so the failure is ignored.
 */
export function openDialer(href: string): void {
  Linking.openURL(href).catch(() => undefined);
}
