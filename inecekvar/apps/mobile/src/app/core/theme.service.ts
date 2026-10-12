import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { PREF_KEYS, readPref, writePref } from './local-prefs';

export const THEME_PREFS = ['system', 'light', 'dark'] as const;
export type ThemePref = (typeof THEME_PREFS)[number];

export const DARK_CLASS = 'ion-palette-dark';
const CHROME_LIGHT = '#14213D';
const CHROME_DARK = '#060D1D';

export function isThemePref(value: unknown): value is ThemePref {
  return typeof value === 'string' && (THEME_PREFS as readonly string[]).includes(value);
}

/** Applies light or dark mode from the stored choice, following the system when asked to. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);

  readonly pref = signal<ThemePref>(this.initialPref());
  readonly dark = computed(() =>
    this.pref() === 'system' ? this.systemDark() : this.pref() === 'dark',
  );

  constructor() {
    const onChange = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    this.media?.addEventListener?.('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener?.('change', onChange));

    effect(() => {
      const dark = this.dark();
      const root = this.document.documentElement;
      root.classList.toggle(DARK_CLASS, dark);
      root.style.colorScheme = dark ? 'dark' : 'light';
      this.document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? CHROME_DARK : CHROME_LIGHT);
    });
  }

  set(pref: ThemePref): void {
    this.pref.set(pref);
    writePref(PREF_KEYS.theme, pref);
  }

  private initialPref(): ThemePref {
    const stored = readPref(PREF_KEYS.theme);
    return isThemePref(stored) ? stored : 'system';
  }
}
