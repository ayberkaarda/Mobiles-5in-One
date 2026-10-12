import { computed, Injectable, signal } from '@angular/core';
import { PREF_KEYS, readPref, writePref } from './local-prefs';

/**
 * Guest favourites, kept on this device by line slug (user story 7). Signed-in sync arrives
 * with the data-access layer and merges this set into the account.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesStore {
  private readonly slugs = signal<readonly string[]>(this.restore());

  readonly all = this.slugs.asReadonly();
  readonly count = computed(() => this.slugs().length);

  has(slug: string): boolean {
    return this.slugs().includes(slug);
  }

  toggle(slug: string): void {
    const next = this.has(slug) ? this.slugs().filter((s) => s !== slug) : [...this.slugs(), slug];
    this.slugs.set(next);
    writePref(PREF_KEYS.favorites, JSON.stringify(next));
  }

  private restore(): string[] {
    const raw = readPref(PREF_KEYS.favorites);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
    } catch {
      return [];
    }
  }
}
