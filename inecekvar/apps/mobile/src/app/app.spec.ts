import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { TranslocoService } from '@jsverse/transloco';
import { appRoutes } from './app.routes';
import { i18nTesting } from './testing/i18n.testing';
import { TABS, TabsPage } from './tabs/tabs.page';

describe('TabsPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabsPage, i18nTesting()],
      providers: [provideIonicAngular({}), provideRouter([])],
    }).compileComponents();
  });

  const labels = (element: HTMLElement) =>
    Array.from(element.querySelectorAll('ion-tab-button ion-label')).map((l) =>
      l.textContent?.trim(),
    );

  it('shows the five tabs in Turkish by default', async () => {
    const fixture = TestBed.createComponent(TabsPage);
    await fixture.whenStable();
    expect(labels(fixture.nativeElement)).toEqual([
      'Ara',
      'Planla',
      'Favoriler',
      'Katkı',
      'Ayarlar',
    ]);
  });

  it('re-renders the tab labels when the language changes', async () => {
    const fixture = TestBed.createComponent(TabsPage);
    await fixture.whenStable();
    TestBed.inject(TranslocoService).setActiveLang('en');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(labels(fixture.nativeElement)).toEqual([
      'Search',
      'Plan',
      'Favourites',
      'Contribute',
      'Settings',
    ]);
  });
});

describe('appRoutes', () => {
  it('lazy-loads one route per tab under the shell and a catch-all page', () => {
    const shell = appRoutes[0];
    const children = shell?.children ?? [];
    expect(shell?.loadComponent).toBeTypeOf('function');
    for (const tab of TABS) {
      const route = children.find((r) => r.path === tab.path);
      expect(route?.loadComponent, tab.path).toBeTypeOf('function');
    }
    expect(appRoutes.at(-1)?.path).toBe('**');
  });

  it('resolves every lazy page', async () => {
    const loaders = [
      ...(appRoutes[0]?.children ?? []).map((r) => r.loadComponent),
      appRoutes.at(-1)?.loadComponent,
    ].filter((l) => l !== undefined);
    const components = await Promise.all(loaders.map((load) => load()));
    expect(components.every((c) => typeof c === 'function')).toBe(true);
  });
});
