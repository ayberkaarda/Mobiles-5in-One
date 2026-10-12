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
  imports: [RouterLink, StatusPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      <main>
        <h1>{{ page.from.name }}–{{ page.to.name }} arası hatlar</h1>
        @if (page.city.is_sample) {
          <p>Bu şehirdeki veriler örnek veridir.</p>
        }
        <p>
          <a [routerLink]="['/', page.city.slug, 'durak', page.from.slug]">{{ page.from.name }}</a>
          – <a [routerLink]="['/', page.city.slug, 'durak', page.to.slug]">{{ page.to.name }}</a>
        </p>
        <ul>
          @for (line of page.lines; track line.slug) {
            <li>
              <a [routerLink]="['/', page.city.slug, 'hat', line.slug]"
                >{{ line.code }} {{ line.name }}</a
              >
            </li>
          }
        </ul>
        @if (page.lines.length === 0) {
          <p>İki duraktan da geçen yayımlanmış hat henüz yok.</p>
        }
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
  `,
})
export class RoutePage extends PageView<RouteData> {
  constructor() {
    super();
    this.connect(routeSeo, routeJsonLd);
  }
}
