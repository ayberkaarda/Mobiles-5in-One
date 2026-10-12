import { computed, Injectable, signal } from '@angular/core';
import { isLineMode, LineMode } from '@inecekvar/domain';
import { PREF_KEYS, readPref, writePref } from './local-prefs';

/** What the favourites tab needs to list a line without a network call. */
export interface FavoriteLine {
  city: string;
  slug: string;
  code: string;
  name: string;
  mode: LineMode;
}

function isFavoriteLine(value: unknown): value is FavoriteLine {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['city'] === 'string' &&
    typeof v['slug'] === 'string' &&
    typeof v['code'] === 'string' &&
    typeof v['name'] === 'string' &&
    isLineMode(v['mode'])
  );
}

const sameLine = (a: Pick<FavoriteLine, 'city' | 'slug'>, b: Pick<FavoriteLine, 'city' | 'slug'>) =>
  a.city === b.city && a.slug === b.slug;

/**
 * Guest favourites, kept on this device (user story 7). Line slugs are unique per city, so an
 * entry is keyed by city and slug and carries the code, name and mode it was saved with.
 * Signed-in sync is a later package and merges this list into the account.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesStore {
  private readonly lines = signal<readonly FavoriteLine[]>(this.restore());

  readonly all = this.lines.asReadonly();
  readonly count = computed(() => this.lines().length);

  has(city: string, slug: string): boolean {
    return this.lines().some((line) => sameLine(line, { city, slug }));
  }

  toggle(line: FavoriteLine): void {
    const entry: FavoriteLine = {
      city: line.city,
      slug: line.slug,
      code: line.code,
      name: line.name,
      mode: line.mode,
    };
    const next = this.has(line.city, line.slug)
      ? this.lines().filter((l) => !sameLine(l, entry))
      : [...this.lines(), entry];
    this.lines.set(next);
    writePref(PREF_KEYS.favorites, JSON.stringify(next));
  }

  private restore(): FavoriteLine[] {
    const raw = readPref(PREF_KEYS.favorites);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      // Entries from the 3A shell were bare sample slugs without a city; they are dropped.
      return Array.isArray(parsed) ? parsed.filter(isFavoriteLine) : [];
    } catch {
      return [];
    }
  }
}
