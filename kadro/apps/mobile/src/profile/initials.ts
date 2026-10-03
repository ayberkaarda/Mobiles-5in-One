/** A leading bracketed tag such as the sample marker in "[ÖRNEK] Deniz Kaptan". */
const LEADING_TAG = /^\s*\[[^\]]*\]\s*/u;

/**
 * The name without a leading bracketed tag, for initials and short labels: "[ÖRNEK] Deniz Kaptan"
 * -> "Deniz Kaptan". The full name (with the tag) stays the visible title elsewhere.
 */
export function withoutTag(name: string): string {
  return name.replace(LEADING_TAG, '').trim();
}

/** Up to two initials of the display name, shown when there is no photo; a leading tag is skipped. */
export function initialsOf(displayName: string): string {
  return withoutTag(displayName)
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toLocaleUpperCase('tr');
}
