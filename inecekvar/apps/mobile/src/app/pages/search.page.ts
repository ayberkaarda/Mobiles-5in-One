import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonSearchbar, IonToolbar } from '@ionic/angular';
import { NoticeComponent, StateComponent } from '@inecekvar/ui';
import { CityPickerComponent } from '../city/city-picker.component';
import { CityStore } from '../city/city.store';
import { LanguageService } from '../core/language.service';
import { TPipe, TpPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { PackManager } from '../packs/pack-manager';
import { apiLineId } from '../packs/pack-data';
import { PackRegistry } from '../packs/pack-registry';
import { ModeFilter, SearchStore } from '../search/search.store';
import { ConnectivityService } from '../shared/connectivity.service';
import { lineMode } from '../shared/format';
import { LineItem, LineListComponent } from '../shared/line-list.component';

const FILTERS: readonly { value: ModeFilter; label: TranslationKey }[] = [
  { value: 'all', label: 'search.filterAll' },
  { value: 'dolmus', label: 'mode.dolmus' },
  { value: 'minibus', label: 'mode.minibus' },
  { value: 'servis', label: 'mode.servis' },
];

interface PackPrompt {
  state: string;
  title: TranslationKey;
  body: TranslationKey;
  action: TranslationKey;
}

@Component({
  selector: 'iv-search-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonContent,
    IonSearchbar,
    RouterLink,
    CityPickerComponent,
    LineListComponent,
    NoticeComponent,
    StateComponent,
    TPipe,
    TpPipe,
  ],
  providers: [SearchStore],
  templateUrl: './search.page.html',
  styleUrl: './search.page.scss',
})
export class SearchPage {
  private readonly i18n = inject(LanguageService);
  private readonly picker = viewChild(CityPickerComponent);
  protected readonly cities = inject(CityStore);
  protected readonly search = inject(SearchStore);
  protected readonly filters = FILTERS;
  private readonly packs = inject(PackRegistry);
  private readonly manager = inject(PackManager);
  private readonly connectivity = inject(ConnectivityService);

  /** The pack prompt for the selected city: install, installed, or update available. */
  protected readonly pack = computed<PackPrompt | null>(() => {
    const city = this.cities.selected();
    if (!city || !this.packs.loaded()) return null;
    const state = this.manager.state(city);
    if (state === 'update') {
      return {
        state,
        title: 'search.packUpdateTitle',
        body: 'search.packUpdateBody',
        action: 'search.packUpdateAction',
      };
    }
    if (state === 'installed') {
      return {
        state,
        title: 'search.packInstalledTitle',
        body: 'search.packInstalledBody',
        action: 'search.packManage',
      };
    }
    return {
      state,
      title: 'search.packTitle',
      body: 'search.packBody',
      action: 'search.packAction',
    };
  });

  /** Offline, but the selected city's pack answers the search. */
  protected readonly offlineWithPack = computed(
    () => !this.connectivity.online() && this.packs.has(this.cities.selectedSlug()),
  );

  protected readonly lineItems = computed<LineItem[]>(() => {
    const city = this.cities.selectedSlug() ?? '';
    return this.search.lines().map((line) => ({
      city,
      slug: line.slug,
      code: line.code,
      name: line.name,
      mode: lineMode(line.mode),
      lineId: apiLineId(line.id),
    }));
  });

  protected readonly nearbyItems = computed<LineItem[]>(() => {
    const state = this.search.nearby();
    const city = this.cities.selectedSlug() ?? '';
    if (state.kind !== 'ready') return [];
    return state.lines.map(({ line, stopName, distanceM }) => ({
      city,
      slug: line.slug,
      code: line.code,
      name: line.name,
      mode: lineMode(line.mode),
      meta: [stopName, this.distance(distanceM)],
    }));
  });

  constructor() {
    void this.cities.init();
    void this.packs.ready();
  }

  protected openPicker(): void {
    this.picker()?.show();
  }

  private distance(meters: number): string {
    return meters < 1000
      ? this.i18n.t('nearby.meters', { value: Math.max(10, Math.round(meters / 10) * 10) })
      : this.i18n.t('nearby.kilometers', {
          value: (meters / 1000).toLocaleString(this.i18n.lang(), { maximumFractionDigits: 1 }),
        });
  }
}
