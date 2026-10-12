import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LINE_MODES, LineMode } from '@inecekvar/domain';
import { LineCardComponent, LineCardLabels } from '@inecekvar/ui';
import { FavoritesStore } from '../core/favorites.store';
import { LanguageService } from '../core/language.service';
import { LineSummary } from '../sample/sample-lines';

/** A list of line cards wired to translations and the guest favourites store. */
@Component({
  selector: 'iv-line-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LineCardComponent],
  template: `
    <ul class="iv-stack" role="list">
      @for (line of lines(); track line.slug) {
        <li>
          <iv-line-card
            [code]="line.code"
            [name]="line.name"
            [mode]="line.mode"
            [fareMinor]="line.fareMinor"
            [meta]="meta(line)"
            [labels]="labels()[line.mode]"
            [favorite]="favorites.has(line.slug)"
            (favoriteToggle)="favorites.toggle(line.slug)"
          />
        </li>
      }
    </ul>
  `,
  styles: `
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
  `,
})
export class LineListComponent {
  private readonly i18n = inject(LanguageService);
  protected readonly favorites = inject(FavoritesStore);

  readonly lines = input.required<readonly LineSummary[]>();

  protected readonly labels = computed(() => {
    const shared = {
      fare: this.i18n.t('fare.label'),
      fareFree: this.i18n.t('fare.free'),
      fareUnknown: this.i18n.t('fare.unknown'),
      favoriteAdd: this.i18n.t('line.favoriteAdd'),
      favoriteRemove: this.i18n.t('line.favoriteRemove'),
    };
    return Object.fromEntries(
      LINE_MODES.map((mode) => [mode, { ...shared, mode: this.i18n.t(`mode.${mode}`) }]),
    ) as Record<LineMode, LineCardLabels>;
  });

  protected meta(line: LineSummary): string[] {
    return [this.i18n.t('line.stops', { count: line.stopCount }), line.hoursText];
  }
}
