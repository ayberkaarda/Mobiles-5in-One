/**
 * Folds Turkish text for search (ADR-0039): Turkish lower-casing (`İ → i`, `I → ı`, then
 * `ı → i`), diacritics removed (`ç ğ ö ş ü → c g o s u`), whitespace collapsed and trimmed.
 * The server stores `venues.search_name = foldTr(name)` and folds every query the same way, so
 * "Kadıköy", "KADIKÖY" and "kadikoy" match each other.
 */
export function foldTr(text: string): string {
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
