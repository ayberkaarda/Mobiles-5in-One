import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { IonContent, IonHeader, IonSearchbar, IonToolbar } from '@ionic/angular';
import { LineMode } from '@inecekvar/domain';
import { StateComponent } from '@inecekvar/ui';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { filterLines, SAMPLE_CITY_LINES } from '../sample/sample-lines';
import { LineListComponent } from '../shared/line-list.component';

type ModeFilter = LineMode | 'all';

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
    LineListComponent,
    StateComponent,
    TPipe,
  ],
  templateUrl: './search.page.html',
  styleUrl: './search.page.scss',
})
export class SearchPage {
  protected readonly filters = FILTERS;
  protected readonly query = signal('');
  protected readonly mode = signal<ModeFilter>('all');
  protected readonly results = computed(() =>
    filterLines(SAMPLE_CITY_LINES, this.query(), this.mode()),
  );

  protected onQuery(value: string | null | undefined): void {
    this.query.set(value ?? '');
  }

  protected clear(): void {
    this.query.set('');
    this.mode.set('all');
  }
}
