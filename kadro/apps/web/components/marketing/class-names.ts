/** Joins the class names that are set: `cx(styles.card, isSunken && styles.cardSunken)`. */
export function cx(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter((name) => typeof name === 'string' && name !== '').join(' ');
}
