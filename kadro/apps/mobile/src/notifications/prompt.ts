import { type PreferenceStorage } from '../settings/language';
import { type PushPermission } from '../settings/push';

/**
 * AsyncStorage key that remembers "not now" on the notification card. A device preference with
 * no account data (like the language), so it is kept across sign-outs.
 */
export const PUSH_PROMPT_STORAGE_KEY = 'kadro.pushPrompt';
const DISMISSED = 'dismissed';

export async function promptDismissed(storage: PreferenceStorage): Promise<boolean> {
  try {
    return (await storage.getItem(PUSH_PROMPT_STORAGE_KEY)) === DISMISSED;
  } catch {
    // Unreadable storage: show the card; the user can dismiss it again.
    return false;
  }
}

export async function dismissPrompt(storage: PreferenceStorage): Promise<void> {
  try {
    await storage.setItem(PUSH_PROMPT_STORAGE_KEY, DISMISSED);
  } catch {
    // Not saved: the card is hidden for this run and may come back after a restart.
  }
}

/**
 * The card explains notifications before the system prompt and is the only place outside the
 * settings that can start it. It shows only while the user has not decided (the system prompt
 * can still be shown) and has not chosen "not now" on this device.
 */
export function shouldShowPrompt(
  available: boolean,
  permission: PushPermission,
  dismissed: boolean,
): boolean {
  return available && permission === 'undetermined' && !dismissed;
}
