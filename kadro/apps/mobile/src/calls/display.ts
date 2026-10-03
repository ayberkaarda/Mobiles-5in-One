/**
 * Kick-off of a call split for a scoreboard row: the day as a caption ("Paz 4 Eki") and the time
 * on its own, set in tabular numerals ("20:00"). Device time zone, reader's language. Both parts
 * are empty for an unreadable date.
 */
export function kickoffParts(
  iso: string,
  language: string,
): { readonly day: string; readonly time: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { day: '', time: '' };
  }
  return {
    day: new Intl.DateTimeFormat(language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date),
    time: new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(date),
  };
}

/** Most dashed slots drawn next to a missing count; larger counts show the figure only. */
export const MAX_DRAWN_SLOTS = 5;
