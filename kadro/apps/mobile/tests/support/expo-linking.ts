/** Test double of `expo-linking`: the URL the app was opened with is set by the test. */
let url: string | null = null;

export function useLinkingURL(): string | null {
  return url;
}

export function __setLinkingURL(next: string | null): void {
  url = next;
}

let opened: string[] = [];

/** Records the URL instead of leaving the app. */
export async function openURL(next: string): Promise<true> {
  opened.push(next);
  return true;
}

export function openedURLs(): readonly string[] {
  return opened;
}

export function __resetOpenedURLs(): void {
  opened = [];
}

let settingsOpened = 0;

/** Records that the system settings were requested instead of leaving the app. */
export async function openSettings(): Promise<void> {
  settingsOpened += 1;
}

export function settingsOpenCount(): number {
  return settingsOpened;
}

export function __resetSettingsOpened(): void {
  settingsOpened = 0;
}
