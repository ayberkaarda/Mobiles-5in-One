import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cityCrumbs } from '../content/page-breadcrumbs';
import { LineListData } from '../content/page-data';
import { lineListDescription, lineListSubject } from '../content/page-text';
import { PageView } from '../content/page-view';
import { modeLabel } from '../content/public-types';
import { breadcrumbList, JsonLdNode } from '../seo/json-ld';
import { pagePath, PageSeo } from '../seo/seo';
import { StatusPageComponent } from './status-page.component';

export function lineListSeo({ city, page, hasNext }: LineListData): PageSeo {
  return {
    title: lineListSubject(city.name, page),
    description: lineListDescription(city.name, page),
    path: `/${city.slug}/hatlar`,
    page,
    index: !city.is_sample && city.published_line_count > 0,
    pagination: {
      prevPage: page > 1 ? page - 1 : null,
      nextPage: hasNext && page < 9999 ? page + 1 : null,
    },
  };
}
export function lineListJsonLd(origin: string, { city }: LineListData): JsonLdNode[] {
  return [
    breadcrumbList(origin, [...cityCrumbs(city), { name: 'Hatlar', path: `/${city.slug}/hatlar` }]),
  ];
}
@Component({
  selector: 'iv-line-list-page',
  standalone: true,
  imports: [RouterLink, StatusPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      <main>
        <h1>{{ page.city.name }} hat listesi</h1>
        @if (page.city.is_sample) {
          <p>Bu şehirdeki veriler örnek veridir.</p>
        }
        @if (page.lines.length === 0) {
          <p>Bu şehirde henüz yayımlanmış hat yok.</p>
        }
        <ol [attr.start]="(page.page - 1) * 50 + 1">
          @for (line of page.lines; track line.slug) {
            <li>
              <a [routerLink]="['/', page.city.slug, 'hat', line.slug]"
                >{{ line.code }} {{ line.name }}</a
              >
              · {{ mode(line.mode) }}
            </li>
          }
        </ol>
        <nav aria-label="Hat listesi sayfaları">
          @if (page.page > 1) {
            <a rel="prev" [href]="pageLink('/' + page.city.slug + '/hatlar', page.page - 1)"
              >Önceki sayfa</a
            >
          }
          <span>Sayfa {{ page.page }}</span>
          @if (page.hasNext && page.page < 9999) {
            <a rel="next" [href]="pageLink('/' + page.city.slug + '/hatlar', page.page + 1)"
              >Sonraki sayfa</a
            >
          }
        </nav>
      </main>
    } @else if (page.state === 'not_found') {
      <iv-status-page kind="not-found" />
    } @else {
      <iv-status-page kind="unavailable" />
    }
  `,
  styles: `
    main {
      max-width: 56rem;
      margin: auto;
      padding: 2rem 1rem;
    }
    li {
      padding: 0.75rem 0;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1.5rem;
      margin-top: 2rem;
    }
  `,
})
export class LineListPage extends PageView<LineListData> {
  protected readonly mode = modeLabel;
  protected readonly pageLink = pagePath;
  constructor() {
    super();
    this.connect(lineListSeo, lineListJsonLd);
  }
}
