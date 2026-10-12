import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { i18nTesting } from '../testing/i18n.testing';
import { contribEn } from './contrib.en';
import { contribTr } from './contrib.tr';
import { en } from './en';
import { AppTranslationLoader, TPipe, TpPipe } from './i18n';
import { tr } from './tr';
import { isAppLang } from './translation';
import { LanguageService } from '../core/language.service';

function flatten(value: object, prefix = ''): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((acc, [key, v]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof v === 'string' ? { ...acc, [path]: v } : { ...acc, ...flatten(v, path) };
  }, {});
}

describe('translations', () => {
  const trFlat = flatten({ ...tr, ...contribTr });
  const enFlat = flatten({ ...en, ...contribEn });

  it('keeps the lazily loaded contributor copy apart from the main keys', () => {
    for (const key of Object.keys(contribTr)) expect(Object.keys(tr)).not.toContain(key);
  });

  it('has the same keys in Turkish and English', () => {
    expect(Object.keys(enFlat).sort()).toEqual(Object.keys(trFlat).sort());
  });

  it('has no empty strings and keeps the same placeholders per key', () => {
    const placeholders = (s: string) => (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();
    for (const [key, value] of Object.entries(trFlat)) {
      expect(value.trim(), key).not.toBe('');
      expect(enFlat[key]?.trim(), key).not.toBe('');
      expect(placeholders(enFlat[key] ?? ''), key).toEqual(placeholders(value));
    }
  });

  it('recognises only the supported languages', () => {
    expect(isAppLang('tr')).toBe(true);
    expect(isAppLang('en')).toBe(true);
    expect(isAppLang('de')).toBe(false);
    expect(isAppLang(undefined)).toBe(false);
  });
});

describe('AppTranslationLoader', () => {
  it('serves Turkish from the bundle and English with its contributor copy from lazy chunks', async () => {
    const loader = new AppTranslationLoader();
    expect(await firstValueFrom(loader.getTranslation('tr'))).toBe(tr);
    expect(await firstValueFrom(loader.getTranslation('en'))).toEqual({ ...en, ...contribEn });
  });
});

@Component({
  imports: [TPipe, TpPipe],
  template: `<p>{{ 'line.stops' | tp: count() }}</p>
    <h2>{{ 'tabs.search' | t }}</h2>`,
})
class PipeHost {
  readonly count = signal(4);
}

describe('TPipe', () => {
  it('translates typed keys, picks plural forms and follows the active language', async () => {
    TestBed.configureTestingModule({ imports: [PipeHost, i18nTesting()] });
    const fixture = TestBed.createComponent(PipeHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const text = () => root.querySelector('p')?.textContent?.trim();
    expect(text()).toBe('4 durak');
    expect(root.querySelector('h2')?.textContent?.trim()).toBe('Ara');
    await TestBed.inject(LanguageService).set('en');
    fixture.componentInstance.count.set(1);
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text()).toBe('1 stop');
    fixture.componentInstance.count.set(1250);
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text()).toBe('1,250 stops');
  });
});

describe('plural forms and number formats', () => {
  const plurals = (value: object, prefix = ''): string[] =>
    Object.entries(value).flatMap(([key, v]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof v === 'string') return [];
      return 'other' in v ? [path] : plurals(v, path);
    });

  it('gives every plural key both forms in both languages, with {{count}} in each', () => {
    const trKeys = plurals({ ...tr, ...contribTr }).sort();
    expect(plurals({ ...en, ...contribEn }).sort()).toEqual(trKeys);
    expect(trKeys.length).toBeGreaterThan(15);
    const flatTr = flatten({ ...tr, ...contribTr });
    const flatEn = flatten({ ...en, ...contribEn });
    for (const key of trKeys) {
      for (const form of ['one', 'other']) {
        expect(flatTr[`${key}.${form}`], key).toContain('{{count}}');
        expect(flatEn[`${key}.${form}`], key).toContain('{{count}}');
      }
      // English needs a different singular; Turkish keeps the noun as it is after numbers.
      expect(flatTr[`${key}.one`], key).toBe(flatTr[`${key}.other`]);
    }
    expect(flatEn['line.stops.one']).not.toBe(flatEn['line.stops.other']);
  });

  it('formats counts with Intl in the active language', async () => {
    TestBed.configureTestingModule({ imports: [i18nTesting()] });
    const language = TestBed.inject(LanguageService);
    await language.set('tr');
    expect(language.tp('search.lineCount', 1)).toBe('1 hat');
    expect(language.tp('search.lineCount', 12500)).toBe('12.500 hat');
    expect(language.tp('favorites.mergePartial', 2)).toContain('2 favori');
    await language.set('en');
    expect(language.tp('search.lineCount', 1)).toBe('1 line');
    expect(language.tp('search.lineCount', 0)).toBe('0 lines');
    expect(language.tp('planner.stepRideDetail', 1, { board: 'A', alight: 'B' })).toBe(
      'A → B · 1 stop',
    );
  });
});
