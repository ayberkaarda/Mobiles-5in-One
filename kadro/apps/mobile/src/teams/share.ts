import { Share } from 'react-native';

/**
 * Hands an invite to the system share sheet. Copying to the clipboard needs a clipboard module,
 * which the app does not have yet; the share sheet offers "copy" on both platforms, and the code is
 * selectable on screen.
 */
export interface SharePort {
  share(message: string): Promise<void>;
}

export const systemShare: SharePort = {
  async share(message) {
    await Share.share({ message });
  },
};

/**
 * Only an https link without spaces that carries this invite's code may become a QR code or a
 * shared message (contract: `httpsUrlSchema`, landing page `/mac/<code>`).
 */
export function isShareableInviteUrl(url: string, code: string): boolean {
  return url.length <= 2048 && /^https:\/\/[^\s/?#@]+\/\S*$/.test(url) && url.includes(code);
}
