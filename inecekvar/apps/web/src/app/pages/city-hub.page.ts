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
  imports: [RouterLink, StatusPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      <main>
        <h1>{{ page.city.name }} dolmuş ve minibüs hatları</h1>
        @if (page.city.is_sample) {
          <p class="notice">Bu şehirdeki veriler örnek veridir.</p>
        }
        <p>{{ page.city.published_line_count }} yayımlanmış hat</p>
        @if (page.city.published_line_count === 0) {
          <p>Bu şehirde henüz yayımlanmış hat yok.</p>
        }
        <a [routerLink]="['/', page.city.slug, 'hatlar']">Tüm hatlar</a>
        <section>
          <h2>Popüler hatlar</h2>
          <ul>
            @for (line of page.city.popular_lines; track line.slug) {
              <li>
                <a [routerLink]="['/', page.city.slug, 'hat', line.slug]"
                  >{{ line.code }} {{ line.name }}</a
                >
              </li>
            }
          </ul>
        </section>
        <section>
          <h2>Son güncellenen hatlar</h2>
          <ul>
            @for (line of page.city.recently_updated_lines; track line.slug) {
              <li>
                <a [routerLink]="['/', page.city.slug, 'hat', line.slug]"
                  >{{ line.code }} {{ line.name }}</a
                >
                · {{ date(line.updated_at) }}
              </li>
            }
          </ul>
        </section>
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
    section {
      margin-top: 2rem;
    }
    li {
      padding: 0.5rem 0;
    }
    .notice {
      border-left: 0.25rem solid var(--iv-color-dolmus-sarisi);
      padding: 0.75rem;
    }
  `,
})
export class CityHubPage extends PageView<CityData> {
  protected readonly date = formatTurkishDate;
  constructor() {
    super();
    this.connect(cityHubSeo, cityHubJsonLd);
  }
}
