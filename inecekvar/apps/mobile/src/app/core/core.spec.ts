import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { i18nTesting } from '../testing/i18n.testing';
import { LanguageService } from './language.service';
import { PREF_KEYS } from './local-prefs';
import { DARK_CLASS, ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove(DARK_CLASS);
  });

  it('follows the system by default and applies an explicit choice', async () => {
    const theme = TestBed.inject(ThemeService);
    expect(theme.pref()).toBe('system');
    theme.set('dark');
    TestBed.tick();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    expect(localStorage.getItem(PREF_KEYS.theme)).toBe('dark');
    theme.set('light');
    TestBed.tick();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);
  });

  it('restores a stored choice and ignores junk values', () => {
    localStorage.setItem(PREF_KEYS.theme, 'dark');
    expect(TestBed.inject(ThemeService).pref()).toBe('dark');
    TestBed.resetTestingModule();
    localStorage.setItem(PREF_KEYS.theme, 'neon');
    expect(TestBed.inject(ThemeService).pref()).toBe('system');
  });
});

describe('LanguageService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [i18nTesting()] });
  });

  it('starts in Turkish and switches to English, mirroring <html lang>', async () => {
    const language = TestBed.inject(LanguageService);
    await language.init();
    expect(language.lang()).toBe('tr');
    expect(language.t('tabs.search')).toBe('Ara');
    await language.set('en');
    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(language.t('tabs.search')).toBe('Search');
    expect(localStorage.getItem(PREF_KEYS.lang)).toBe('en');
  });

  it('restores the stored language and falls back to Turkish on junk', async () => {
    localStorage.setItem(PREF_KEYS.lang, 'en');
    const language = TestBed.inject(LanguageService);
    await language.init();
    expect(language.lang()).toBe('en');
    localStorage.setItem(PREF_KEYS.lang, 'xx');
    await language.init();
    expect(language.lang()).toBe('tr');
  });
});
