/** Test double of `expo-linking`: the URL the app was opened with is set by the test. */
let url: string | null = null;

export function useLinkingURL(): string | null {
  return url;
}

export function __setLinkingURL(next: string | null): void {
  url = next;
}
