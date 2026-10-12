import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { LINE_MODES, LineMode } from '@inecekvar/domain';
import { LineCardComponent, LineCardLabels } from '@inecekvar/ui';
import { FavoritesStore } from '../core/favorites.store';
import { LanguageService } from '../core/language.service';
import { localeOf } from './format';

/** One row of a line list; `fareMinor` left out hides the fare chip (search results carry none). */
export interface LineItem {
  city: string;
  slug: string;
  code: string;
  name: string;
  mode: LineMode;
  /** API line id when known; lets a signed-in favourite skip a lookup. */
  lineId?: string;
  fareMinor?: number | null;
  meta?: readonly string[];
}

/** Path and query of the line page for one line. */
export function linePageLink(line: Pick<LineItem, 'city' | 'slug'>): [string[], { city: string }] {
  return [['/hat', line.slug], { city: line.city }];
}

/** A list of line cards wired to translations, the line page and the guest favourites. */
@Component({
  selector: 'iv-line-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LineCardComponent],
  template: `
    <ul class="iv-stack" role="list">
      @for (line of lines(); track line.city + '/' + line.slug) {
        <li>
          <iv-line-card
            [code]="line.code"
            [name]="line.name"
            [mode]="line.mode"
            [fareMinor]="line.fareMinor"
            [locale]="locale()"
            [meta]="line.meta ?? []"
            [labels]="labels()[line.mode]"
            [favorite]="favorites.has(line.city, line.slug)"
            (opened)="open(line)"
            (favoriteToggle)="favorites.toggle(line)"
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
  protected readonly locale = computed(() => localeOf(this.i18n.lang()));

  private readonly router = inject(Router);
  protected readonly favorites = inject(FavoritesStore);

  readonly lines = input.required<readonly LineItem[]>();

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

  protected open(line: LineItem): void {
    const [path, queryParams] = linePageLink(line);
    void this.router.navigate(path, { queryParams });
  }
}
