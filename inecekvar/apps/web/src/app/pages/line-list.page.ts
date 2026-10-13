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
import { SiteFooterComponent } from '../home/site-footer.component';
import { SiteHeaderComponent } from '../home/site-header.component';
import { RouteBoardComponent } from './route-board.component';

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
  imports: [
    RouterLink,
    StatusPageComponent,
    SiteHeaderComponent,
    SiteFooterComponent,
    RouteBoardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      <iv-site-header />
      <main id="icerik" class="iv-wrap">
        <p class="iv-crumbs">
          <a [routerLink]="['/', page.city.slug]">{{ page.city.name }}</a>
          <span aria-hidden="true">/</span>
          <span>Hatlar</span>
        </p>
        <h1>{{ page.city.name }} hat listesi</h1>
        @if (page.city.is_sample) {
          <p class="notice">
            <span class="iv-tape">örnek veri</span> Bu şehirdeki veriler örnek veridir.
          </p>
        }
        @if (page.lines.length === 0) {
          <p>Bu şehirde henüz yayımlanmış hat yok.</p>
        }
        <ol class="boards" [attr.start]="(page.page - 1) * 50 + 1">
          @for (line of page.lines; track line.slug) {
            <li>
              <iv-route-board
                [code]="line.code"
                [name]="line.name"
                [meta]="mode(line.mode)"
                [link]="['/', page.city.slug, 'hat', line.slug]"
              />
            </li>
          }
        </ol>
        <nav class="pages" aria-label="Hat listesi sayfaları">
          @if (page.page > 1) {
            <a
              class="iv-cta iv-cta--ghost"
              rel="prev"
              [href]="pageLink('/' + page.city.slug + '/hatlar', page.page - 1)"
              >Önceki sayfa</a
            >
          }
          <span>Sayfa {{ page.page }}</span>
          @if (page.hasNext && page.page < 9999) {
            <a
              class="iv-cta iv-cta--ghost"
              rel="next"
              [href]="pageLink('/' + page.city.slug + '/hatlar', page.page + 1)"
              >Sonraki sayfa</a
            >
          }
        </nav>
      </main>
      <iv-site-footer />
    } @else if (page.state === 'not_found') {
      <iv-status-page kind="not-found" />
    } @else {
      <iv-status-page kind="unavailable" />
    }
  `,
  styles: `
    h1 {
      margin: 1rem 0 0;
      font-size: clamp(2rem, 5vw, 3rem);
      line-height: 1.05;
      letter-spacing: -0.03em;
    }
    .notice {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      color: var(--iv-ink-muted);
    }
    .boards {
      display: grid;
      gap: 0.85rem;
      margin: 1.75rem 0 0;
      padding: 0;
      list-style: none;
    }
    @media (min-width: 44rem) {
      .boards {
        grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
      }
    }
    .pages {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1rem 1.5rem;
      margin-top: 2rem;
      color: var(--iv-ink-muted);
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
