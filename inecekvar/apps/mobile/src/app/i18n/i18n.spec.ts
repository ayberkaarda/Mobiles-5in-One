import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { i18nTesting } from '../testing/i18n.testing';
import { en } from './en';
import { AppTranslationLoader, TPipe } from './i18n';
import { tr } from './tr';
import { isAppLang } from './translation';

function flatten(value: object, prefix = ''): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((acc, [key, v]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof v === 'string' ? { ...acc, [path]: v } : { ...acc, ...flatten(v, path) };
  }, {});
}

describe('translations', () => {
  const trFlat = flatten(tr);
  const enFlat = flatten(en);

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
  it('serves Turkish from the bundle and English from the lazy chunk', async () => {
    const loader = new AppTranslationLoader();
    expect(await firstValueFrom(loader.getTranslation('tr'))).toBe(tr);
    expect(await firstValueFrom(loader.getTranslation('en'))).toBe(en);
  });
});

@Component({
  imports: [TPipe],
  template: `<p>{{ 'line.stops' | t: { count: 4 } }}</p>`,
})
class PipeHost {}

describe('TPipe', () => {
  it('translates typed keys with parameters and follows the active language', async () => {
    TestBed.configureTestingModule({ imports: [PipeHost, i18nTesting()] });
    const fixture = TestBed.createComponent(PipeHost);
    await fixture.whenStable();
    const text = () => (fixture.nativeElement as HTMLElement).textContent?.trim();
    expect(text()).toBe('4 durak');
    TestBed.inject(TranslocoService).setActiveLang('en');
    await fixture.whenStable();
    expect(text()).toBe('4 stops');
  });
});
