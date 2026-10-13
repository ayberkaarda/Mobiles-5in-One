import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cityCrumbs } from '../content/page-breadcrumbs';
import { RouteData } from '../content/page-data';
import { routeDescription, routeSubject } from '../content/page-text';
import { PageView } from '../content/page-view';
import { routeIndexable, routePairPath } from '../content/route-pair';
import { breadcrumbList, JsonLdNode } from '../seo/json-ld';
import { PageSeo } from '../seo/seo';
import { StatusPageComponent } from './status-page.component';
import { SiteFooterComponent } from '../home/site-footer.component';
import { SiteHeaderComponent } from '../home/site-header.component';
import { RouteBoardComponent } from './route-board.component';
import { modeLabel } from '../content/public-types';

export function routeSeo({ city, pair, canonical, from, to, lines }: RouteData): PageSeo {
  return {
    title: routeSubject(from.name, to.name),
    description: routeDescription(from.name, to.name, lines.length),
    path: routePairPath(city.slug, pair),
    index: canonical && !city.is_sample && routeIndexable(city.published_line_count),
  };
}
export function routeJsonLd(origin: string, { city, pair, from, to }: RouteData): JsonLdNode[] {
  return [
    breadcrumbList(origin, [
      ...cityCrumbs(city),
      { name: `${from.name}–${to.name} arası hatlar`, path: routePairPath(city.slug, pair) },
    ]),
  ];
}
@Component({
  selector: 'iv-route-page',
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
          <span>Rota</span>
        </p>
        <div class="pair iv-board">
          <h1>{{ page.from.name }}–{{ page.to.name }} arası hatlar</h1>
          <p class="ends">
            <span class="end">
              <span class="cap">Nereden</span>
              <a [routerLink]="['/', page.city.slug, 'durak', page.from.slug]">{{
                page.from.name
              }}</a>
            </span>
            <span class="end">
              <span class="cap">Nereye</span>
              <a [routerLink]="['/', page.city.slug, 'durak', page.to.slug]">{{ page.to.name }}</a>
            </span>
          </p>
        </div>
        @if (page.city.is_sample) {
          <p class="notice">
            <span class="iv-tape">örnek veri</span> Bu şehirdeki veriler örnek veridir.
          </p>
        }
        <h2 class="iv-section-head">İki duraktan da geçen hatlar</h2>
        <ul class="boards" role="list">
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
        </ul>
        @if (page.lines.length === 0) {
          <p>İki duraktan da geçen yayımlanmış hat henüz yok.</p>
        }
      </main>
      <iv-site-footer />
    } @else if (page.state === 'not_found') {
      <iv-status-page kind="not-found" />
    } @else {
      <iv-status-page kind="unavailable" />
    }
  `,
  styles: `
    .pair {
      margin-top: 1rem;
      padding: clamp(1.5rem, 4vw, 2.25rem) clamp(1.25rem, 4vw, 2.25rem) clamp(1.75rem, 4vw, 2.5rem);
      border-radius: 1.5rem;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.8rem, 4.5vw, 2.75rem);
      line-height: 1.06;
      letter-spacing: -0.025em;
      color: var(--iv-board-ink);
      overflow-wrap: anywhere;
    }
    .ends {
      position: relative;
      display: grid;
      gap: 0.75rem;
      margin: 1.25rem 0 0;
      padding-left: 1.75rem;
    }
    .ends::before {
      content: '';
      position: absolute;
      left: 0.4rem;
      top: 0.9rem;
      bottom: 0.9rem;
      width: 4px;
      border-radius: 2px;
      background: var(--iv-rail);
    }
    .end {
      position: relative;
      display: grid;
    }
    .end::before {
      content: '';
      position: absolute;
      left: -1.75rem;
      top: 0.45rem;
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      background: var(--iv-board-sign);
      box-shadow: 0 0 0 3px var(--iv-board);
    }
    .cap {
      font-size: 0.85rem;
      color: var(--iv-board-muted);
    }
    .end a {
      font-family: var(--iv-font-display);
      font-weight: 700;
      font-size: 1.2rem;
      color: var(--iv-board-sign);
    }
    .notice {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      color: var(--iv-ink-muted);
    }
    h2 {
      margin-top: 2.5rem;
    }
    .boards {
      display: grid;
      gap: 0.85rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    @media (min-width: 44rem) {
      .boards {
        grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
      }
    }
  `,
})
export class RoutePage extends PageView<RouteData> {
  protected readonly mode = modeLabel;
  constructor() {
    super();
    this.connect(routeSeo, routeJsonLd);
  }
}
