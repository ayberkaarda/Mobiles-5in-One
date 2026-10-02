const TURKISH_FOLDS: ReadonlyMap<string, string> = new Map([
  ['ç', 'c'],
  ['ğ', 'g'],
  ['ı', 'i'],
  ['ö', 'o'],
  ['ş', 's'],
  ['ü', 'u'],
]);

/**
 * URL slug for Turkish text: Turkish-aware lowercasing, letters folded to ASCII
 * (`Kadıköy` → `kadikoy`, `İzmir` → `izmir`), any other run of characters collapsed to a
 * single hyphen.
 */
export function slugify(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (char) => TURKISH_FOLDS.get(char) ?? char)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
