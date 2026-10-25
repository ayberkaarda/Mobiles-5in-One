import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cityCrumbs } from '../content/page-breadcrumbs';
import { CityData } from '../content/page-data';
import { cityDescription, citySubject } from '../content/page-text';
import { PageView } from '../content/page-view';
import { formatTurkishDate } from '../content/format';
import { breadcrumbList, JsonLdNode } from '../seo/json-ld';
import { PageSeo } from '../seo/seo';
import { StatusPageComponent } from './status-page.component';
import { SiteFooterComponent } from '../home/site-footer.component';
import { SiteHeaderComponent } from '../home/site-header.component';
import { RouteBoardComponent } from './route-board.component';
import { modeLabel } from '../content/public-types';
import { CitySceneComponent } from '@inecekvar/ui';

export function cityHubSeo({ city }: CityData): PageSeo {
  return {
    title: citySubject(city.name),
    description: cityDescription(city),
    path: '/' + city.slug,
    index: !city.is_sample && city.published_line_count > 0,
  };
}
export function cityHubJsonLd(origin: string, { city }: CityData): JsonLdNode[] {
  return [breadcrumbList(origin, cityCrumbs(city))];
}
@Component({
  selector: 'iv-city-hub-page',
  standalone: true,
  imports: [
    RouterLink,
    StatusPageComponent,
    SiteHeaderComponent,
    SiteFooterComponent,
    RouteBoardComponent,
    CitySceneComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      <iv-site-header />
      <main id="icerik" class="iv-wrap">
        <p class="iv-crumbs">
          <a routerLink="/">İnecek Var</a>
          <span aria-hidden="true">/</span>
          <span>{{ page.city.name }}</span>
        </p>
        <div class="hub iv-board">
          <iv-city-scene class="scene" [still]="true" />
          <h1>{{ page.city.name }} dolmuş ve minibüs hatları</h1>
          <p class="count">
            <span class="number">{{ page.city.published_line_count }}</span> yayımlanmış hat
          </p>
          @if (page.city.is_sample) {
            <p class="notice">
              <span class="iv-tape">örnek veri</span> Bu şehirdeki veriler örnek veridir.
            </p>
          }
          @if (page.city.published_line_count === 0) {
            <p>Bu şehirde henüz yayımlanmış hat yok.</p>
          }
          <a class="iv-cta all" [routerLink]="['/', page.city.slug, 'hatlar']">Tüm hatlar</a>
        </div>
        <section class="block">
          <h2 class="iv-section-head">Popüler hatlar</h2>
          <ul class="boards" role="list">
            @for (line of page.city.popular_lines; track line.slug) {
              <li>
                <iv-route-board
                  [code]="line.code"
                  [name]="line.name"
                  [meta]="mode(line.mode)"
                  [link]="['/', page.city.slug, 'hat', line.slug]"
                />
              </li>
            }
          </ul>
        </section>
        <section class="block">
          <h2 class="iv-section-head">Son güncellenen hatlar</h2>
          <ol class="recent" role="list">
            @for (line of page.city.recently_updated_lines; track line.slug) {
              <li>
                <a [routerLink]="['/', page.city.slug, 'hat', line.slug]"
                  ><span class="code">{{ line.code }}</span> {{ line.name }}</a
                >
                <span class="date">{{ date(line.updated_at) }}</span>
              </li>
            }
          </ol>
        </section>
      </main>
      <iv-site-footer />
    } @else if (page.state === 'not_found') {
      <iv-status-page kind="not-found" />
    } @else {
      <iv-status-page kind="unavailable" />
    }
  `,
  styles: `
    .hub {
      position: relative;
      overflow: hidden;
      display: grid;
      justify-items: start;
      gap: 0.75rem;
      margin-top: 1rem;
      padding: clamp(1.5rem, 4vw, 2.5rem) clamp(1.25rem, 4vw, 2.5rem) clamp(1.75rem, 4vw, 2.75rem);
      border-radius: 1.5rem;
    }
    .scene {
      display: none;
    }
    @media (min-width: 56rem) {
      .hub {
        padding-right: 44%;
      }
      .scene {
        display: block;
        position: absolute;
        right: -1rem;
        bottom: 0;
        width: 46%;
      }
    }
    h1 {
      max-width: 22ch;
      margin: 0;
      font-size: clamp(2rem, 5vw, 3.25rem);
      line-height: 1.04;
      letter-spacing: -0.03em;
      color: var(--iv-board-sign);
      text-shadow: var(--iv-board-glow);
    }
    .count {
      margin: 0;
      font-size: 1.1rem;
      color: var(--iv-board-muted);
    }
    .number {
      font-family: var(--iv-font-display);
      font-weight: 700;
      font-size: 1.6rem;
      color: var(--iv-board-ink);
      font-variant-numeric: tabular-nums;
    }
    .notice {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin: 0;
      color: var(--iv-board-muted);
    }
    .all {
      margin-top: 0.5rem;
    }
    .block {
      margin-top: 3rem;
    }
    .boards {
      display: grid;
      gap: 1rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    @media (min-width: 44rem) {
      .boards {
        grid-template-columns: 1fr;
      }
    }
    .recent {
      margin: 0;
      padding: 0;
      list-style: none;
      border-top: 1px solid var(--iv-line);
      background: var(--iv-surface);
    }
    .recent li {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.25rem 1rem;
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--iv-line);
    }
    .recent a {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .code {
      font-family: var(--iv-font-display);
      white-space: nowrap;
    }
    .date {
      font-size: 0.9rem;
      color: var(--iv-ink-muted);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class CityHubPage extends PageView<CityData> {
  protected readonly mode = modeLabel;
  protected readonly date = formatTurkishDate;
  constructor() {
    super();
    this.connect(cityHubSeo, cityHubJsonLd);
  }
}
