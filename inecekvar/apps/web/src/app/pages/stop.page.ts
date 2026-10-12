import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cityCrumbs, stopNode } from '../content/page-breadcrumbs';
import { StopData } from '../content/page-data';
import { stopDescription, stopSubject } from '../content/page-text';
import { PageView } from '../content/page-view';
import { breadcrumbList, JsonLdNode } from '../seo/json-ld';
import { PageSeo } from '../seo/seo';
import { StatusPageComponent } from './status-page.component';

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
  imports: [RouterLink, StatusPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      <main>
        <h1>{{ page.stop.name }} durağı</h1>
        <p>
          <a [routerLink]="['/', page.city.slug]">{{ page.city.name }}</a>
        </p>
        @if (page.city.is_sample) {
          <p>Bu şehirdeki veriler örnek veridir.</p>
        }
        <h2>Bu duraktan geçen hatlar</h2>
        <ul>
          @for (line of page.stop.lines; track line.slug) {
            <li>
              <a [routerLink]="['/', page.city.slug, 'hat', line.slug]"
                >{{ line.code }} {{ line.name }}</a
              >
            </li>
          }
        </ul>
        @if (page.stop.lines.length === 0) {
          <p>Bu duraktan geçen yayımlanmış hat henüz yok.</p>
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
export class StopPage extends PageView<StopData> {
  constructor() {
    super();
    this.connect(stopSeo, stopJsonLd);
  }
}
