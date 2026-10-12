import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonSearchbar, IonToolbar } from '@ionic/angular';
import { StateComponent } from '@inecekvar/ui';
import { CityPickerComponent } from '../city/city-picker.component';
import { CityStore } from '../city/city.store';
import { LanguageService } from '../core/language.service';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { ModeFilter, SearchStore } from '../search/search.store';
import { lineMode } from '../shared/format';
import { LineItem, LineListComponent } from '../shared/line-list.component';

const FILTERS: readonly { value: ModeFilter; label: TranslationKey }[] = [
  { value: 'all', label: 'search.filterAll' },
  { value: 'dolmus', label: 'mode.dolmus' },
  { value: 'minibus', label: 'mode.minibus' },
  { value: 'servis', label: 'mode.servis' },
];

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
    StateComponent,
    TPipe,
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

  protected readonly lineItems = computed<LineItem[]>(() => {
    const city = this.cities.selectedSlug() ?? '';
    return this.search.lines().map((line) => ({
      city,
      slug: line.slug,
      code: line.code,
      name: line.name,
      mode: lineMode(line.mode),
      lineId: line.id,
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
