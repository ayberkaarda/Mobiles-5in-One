import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cityCrumbs, stopNode } from '../content/page-breadcrumbs';
import { StopData } from '../content/page-data';
import { stopDescription, stopSubject } from '../content/page-text';
import { PageView } from '../content/page-view';
import { breadcrumbList, JsonLdNode } from '../seo/json-ld';
import { PageSeo } from '../seo/seo';
import { StatusPageComponent } from './status-page.component';
import { SiteFooterComponent } from '../home/site-footer.component';
import { SiteHeaderComponent } from '../home/site-header.component';
import { RouteBoardComponent } from './route-board.component';
import { modeLabel } from '../content/public-types';
import { StopSignComponent } from '@inecekvar/ui';

export function stopSeo({ city, stop }: StopData): PageSeo {
  return {
    title: stopSubject(stop.name, city.name),
    description: stopDescription(stop.name, city.name, stop.lines.length),
    path: `/${city.slug}/durak/${stop.slug}`,
    appBanner: true,
    index: !city.is_sample,
  };
}
export function stopJsonLd(origin: string, { city, stop }: StopData): JsonLdNode[] {
  return [
    breadcrumbList(origin, [
      ...cityCrumbs(city),
      { name: stop.name, path: `/${city.slug}/durak/${stop.slug}` },
    ]),
    stopNode(origin, city, stop),
  ];
}
@Component({
  selector: 'iv-stop-page',
  standalone: true,
  imports: [
    RouterLink,
    StatusPageComponent,
    SiteHeaderComponent,
    SiteFooterComponent,
    RouteBoardComponent,
    StopSignComponent,
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
          <span>Durak</span>
        </p>
        <iv-stop-sign class="sign">
          <p class="kind">{{ page.stop.kind === 'informal' ? 'İşaretsiz durak' : 'Durak' }}</p>
          <h1>{{ page.stop.name }} durağı</h1>
        </iv-stop-sign>
        @if (page.city.is_sample) {
          <p class="notice">
            <span class="iv-tape">örnek veri</span> Bu şehirdeki veriler örnek veridir.
          </p>
        }
        <h2 class="iv-section-head">Bu duraktan geçen hatlar</h2>
        <ul class="boards" role="list">
          @for (line of page.stop.lines; track line.slug) {
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
        @if (page.stop.lines.length === 0) {
          <p>Bu duraktan geçen yayımlanmış hat henüz yok.</p>
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
    .sign {
      max-width: 48rem;
      margin-top: 1rem;
    }
    .kind {
      margin: 0 0 0.25rem;
      color: var(--iv-board-muted);
      font-weight: 600;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.9rem, 5vw, 3rem);
      line-height: 1.05;
      letter-spacing: -0.025em;
      color: var(--iv-board-sign);
      text-shadow: var(--iv-board-glow);
      overflow-wrap: anywhere;
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
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    @media (min-width: 44rem) {
      .boards {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class StopPage extends PageView<StopData> {
  protected readonly mode = modeLabel;
  constructor() {
    super();
    this.connect(stopSeo, stopJsonLd);
  }
}
