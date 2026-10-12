import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { DARK_CLASS } from '../core/theme.service';
import { i18nTesting } from '../testing/i18n.testing';
import { ContributePage } from './contribute.page';
import { FavoritesPage } from './favorites.page';
import { NotFoundPage } from './not-found.page';
import { PlanPage } from './plan.page';
import { SearchPage } from './search.page';
import { SettingsPage } from './settings.page';

async function render<T>(page: Type<T>): Promise<ComponentFixture<T>> {
  TestBed.configureTestingModule({
    imports: [page, i18nTesting()],
    providers: [provideIonicAngular({}), provideRouter([])],
  });
  const fixture = TestBed.createComponent(page);
  await fixture.whenStable();
  return fixture;
}

const el = (fixture: ComponentFixture<unknown>) => fixture.nativeElement as HTMLElement;
const text = (fixture: ComponentFixture<unknown>, selector: string) =>
  el(fixture).querySelector(selector)?.textContent?.trim();

describe('tab pages', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    [SearchPage, 'Hat nereden geçer?'],
    [PlanPage, 'Nereden nereye?'],
    [FavoritesPage, 'Favoriler'],
    [ContributePage, 'Bu hat değişti mi? Söyle.'],
    [SettingsPage, 'Ayarlar'],
  ] as const)('%o renders its Turkish heading', async (page, heading) => {
    const fixture = await render<unknown>(page);
    expect(text(fixture, 'h1')).toBe(heading);
  });

  it('search lists the labelled sample lines and filters by mode', async () => {
    const fixture = await render(SearchPage);
    expect(el(fixture).querySelectorAll('iv-line-card')).toHaveLength(3);
    const minibus = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.filter')).find(
      (b) => b.textContent?.trim() === 'Minibüs',
    );
    minibus?.click();
    await fixture.whenStable();
    const cards = el(fixture).querySelectorAll('iv-line-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain('ORN-2');
    expect(minibus?.getAttribute('aria-pressed')).toBe('true');
  });

  it('search shows the empty state for a query without matches and clears it', async () => {
    const fixture = await render(SearchPage);
    const searchbar = el(fixture).querySelector('ion-searchbar');
    searchbar?.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'zzz' } }));
    await fixture.whenStable();
    expect(text(fixture, 'iv-state h2')).toBe('Bu aramaya uyan hat yok');
    el(fixture).querySelector<HTMLButtonElement>('iv-state button')?.click();
    await fixture.whenStable();
    expect(el(fixture).querySelectorAll('iv-line-card')).toHaveLength(3);
  });

  it('a starred search result appears in favourites', async () => {
    const search = await render(SearchPage);
    el(search).querySelector<HTMLButtonElement>('iv-line-card .star')?.click();
    await search.whenStable();
    TestBed.resetTestingModule();
    const favorites = await render(FavoritesPage);
    expect(el(favorites).querySelectorAll('iv-line-card')).toHaveLength(1);
    expect(text(favorites, 'iv-line-card')).toContain('ORN-1');
  });

  it('favourites starts with the empty state', async () => {
    const fixture = await render(FavoritesPage);
    expect(text(fixture, 'iv-state h2')).toBe('Henüz favori hat yok');
  });

  it('plan enables the button only with both ends and asks for a city on submit', async () => {
    const fixture = await render(PlanPage);
    const submit = el(fixture).querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(true);
    const [from, to] = Array.from(el(fixture).querySelectorAll<HTMLInputElement>('input'));
    for (const [input, value] of [
      [from, 'Durak 1'],
      [to, 'Durak 2'],
    ] as const) {
      if (!input) throw new Error('missing input');
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    expect(submit?.disabled).toBe(false);
    el(fixture).querySelector<HTMLButtonElement>('.swap')?.click();
    await fixture.whenStable();
    expect(from?.value).toBe('Durak 2');
    expect(to?.value).toBe('Durak 1');
    submit?.click();
    await fixture.whenStable();
    expect(text(fixture, 'iv-state h2')).toBe('Önce şehrini seç');
  });

  it('settings switches theme and language', async () => {
    const fixture = await render(SettingsPage);
    el(fixture).querySelector<HTMLButtonElement>('[data-value="dark"]')?.click();
    await fixture.whenStable();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    el(fixture).querySelector<HTMLButtonElement>('[data-value="light"]')?.click();
    await fixture.whenStable();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);

    el(fixture).querySelector<HTMLButtonElement>('[data-value="en"]')?.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(text(fixture, 'h1')).toBe('Settings');
    expect(el(fixture).querySelector('[data-value="en"]')?.getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('not-found shows the error state and goes back to search', async () => {
    const fixture = await render(NotFoundPage);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    expect(el(fixture).querySelector('iv-state')?.getAttribute('role')).toBe('alert');
    el(fixture).querySelector<HTMLButtonElement>('iv-state button')?.click();
    expect(navigate).toHaveBeenCalledWith('/ara');
  });
});
