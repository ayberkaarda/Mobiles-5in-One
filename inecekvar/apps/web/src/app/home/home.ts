import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FACTS } from '../../content/facts';
import { HomeData } from '../content/page-data';
import { PageView } from '../content/page-view';
import { StatusPageComponent } from '../pages/status-page.component';
import { breadcrumbList, JsonLdNode, organization, webSite } from '../seo/json-ld';
import { PageSeo } from '../seo/seo';

export function homeSeo(): PageSeo {
  return {
    title: null,
    path: '/',
    index: true,
    follow: true,
    description: FACTS.description,
  };
}
export function homeJsonLd(origin: string, name = 'İnecek Var'): JsonLdNode[] {
  return [
    organization(origin, { name, path: '/' }),
    webSite(origin, { name, path: '/' }),
    breadcrumbList(origin, [{ name, path: '/' }]),
  ];
}
@Component({
  selector: 'iv-home',
  standalone: true,
  imports: [RouterLink, StatusPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      <main>
        <h1>İnecek Var</h1>
        <p>
          Resmî verisi olmayan dolmuş, minibüs ve servis hatlarını mahallelinin birlikte
          haritaladığı, çevrimdışı da çalışan hat rehberi.
        </p>
        <p class="tagline">Dolmuş nereden geçer? Mahalle bilir.</p>
        <section aria-labelledby="cities-title">
          <h2 id="cities-title">Şehirler</h2>
          <ul>
            @for (city of page.cities; track city.slug) {
              <li>
                <a [routerLink]="['/', city.slug]">{{ city.name }}</a> ·
                {{ city.published_line_count }} yayımlanmış hat
                @if (city.is_sample) {
                  <span class="badge">örnek veri</span>
                }
              </li>
            }
          </ul>
        </section>
        <section aria-labelledby="steps-title">
          <h2 id="steps-title">Nasıl çalışır</h2>
          <ol>
            <li>Hattını bul</li>
            <li>Durakları ve ücreti gör</li>
            <li>Eksik ya da yanlışsa düzelt</li>
          </ol>
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
    .tagline {
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
    }
    .badge {
      background: var(--iv-color-dolmus-sarisi);
      padding: 0.2rem 0.5rem;
      border-radius: 0.25rem;
    }
  `,
})
export class Home extends PageView<HomeData> {
  constructor() {
    super();
    this.connect(homeSeo, (origin) => homeJsonLd(origin));
  }
}
