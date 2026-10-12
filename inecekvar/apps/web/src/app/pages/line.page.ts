import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cityCrumbs, stopNode } from '../content/page-breadcrumbs';
import { LineData } from '../content/page-data';
import { formatFare, formatTurkishDate } from '../content/format';
import { projectLine } from '../content/line-geometry';
import { buildLineSummary } from '../content/line-summary';
import { lineDescription, lineSubject } from '../content/page-text';
import { PageView } from '../content/page-view';
import { modeLabel, paymentLabel } from '../content/public-types';
import { LineMapComponent } from '../map/line-map.component';
import { breadcrumbList, busTrip, JsonLdNode, organization } from '../seo/json-ld';
import { PageSeo } from '../seo/seo';
import { StatusPageComponent } from './status-page.component';

export function lineSeo({ city, line }: LineData): PageSeo {
  return {
    title: lineSubject(line.name, line.mode),
    description: lineDescription(line, city.name),
    path: `/${city.slug}/hat/${line.slug}`,
    ogType: 'article',
    ogImagePath: `/og/${city.slug}/hat/${line.slug}.svg`,
    appBanner: true,
    index: !city.is_sample,
  };
}
export function lineJsonLd(origin: string, { city, line }: LineData): JsonLdNode[] {
  const path = `/${city.slug}/hat/${line.slug}`;
  const nodes = [
    breadcrumbList(origin, [
      ...cityCrumbs(city),
      { name: 'Hatlar', path: `/${city.slug}/hatlar` },
      { name: line.name, path },
    ]),
  ];
  const first = line.stops[0];
  const last = line.stops[line.stops.length - 1];
  if (line.stops.length >= 2 && first && last) {
    nodes.push(
      busTrip(origin, {
        name: line.name,
        path,
        departureBusStop: stopNode(origin, city, first),
        arrivalBusStop: stopNode(origin, city, last),
        provider: organization(origin, {
          name: 'İnecek Var katkıcıları',
          path: '/',
          description: 'Topluluk notu: hattı işleten kurum değil, bilgiyi derleyen katkıcılar.',
        }),
      }),
    );
  }
  return nodes;
}
export function lineAppLinks(
  appOrigin: string,
  city: string,
  slug: string,
): { contribute: string; open: string } {
  const contribute = new URL('/katki', appOrigin);
  contribute.searchParams.set('hat', slug);
  contribute.searchParams.set('city', city);
  const open = new URL('/hat/' + encodeURIComponent(slug), appOrigin);
  open.searchParams.set('city', city);
  return { contribute: contribute.href, open: open.href };
}

@Component({
  selector: 'iv-line-page',
  standalone: true,
  imports: [RouterLink, StatusPageComponent, LineMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      <main>
        <h1>{{ page.line.name }} {{ mode(page.line.mode) }} hattı</h1>
        <p class="code">{{ page.line.code }}</p>
        <p class="summary">{{ summary() }}</p>
        @if (sketch(); as drawing) {
          <svg
            [attr.viewBox]="drawing.viewBox"
            role="img"
            [attr.aria-label]="'Güzergâh çizimi: ' + page.line.name"
          >
            <path
              [attr.d]="drawing.pathD"
              fill="none"
              stroke="var(--iv-color-lacivert)"
              stroke-width="9"
            />
            <path
              [attr.d]="drawing.pathD"
              fill="none"
              stroke="var(--iv-color-turkuaz)"
              stroke-width="5"
            />
            @for (stop of drawing.stops; track $index) {
              <circle
                [attr.cx]="stop.cx"
                [attr.cy]="stop.cy"
                r="6"
                fill="var(--iv-color-krem)"
                stroke="var(--iv-color-lacivert)"
                stroke-width="2"
              />
            }
          </svg>
        } @else {
          <p>Güzergâh çizimi henüz yok.</p>
        }
        <iv-line-map [line]="page.line" [city]="page.city.slug" />
        <section>
          <h2>Duraklar</h2>
          <ol>
            @for (stop of page.line.stops; track $index) {
              <li>
                <a [routerLink]="['/', page.city.slug, 'durak', stop.slug]">{{ stop.name }}</a>
              </li>
            }
          </ol>
        </section>
        <dl>
          <dt>Ücret</dt>
          <dd>
            @if (fare(page.line.fare_minor); as price) {
              {{ price }}
              @if (page.line.fare_updated_at; as updated) {
                <span> · son güncelleme: {{ date(updated) }}</span>
              }
            } @else {
              Henüz paylaşılmadı
            }
          </dd>
          <dt>Çalışma saatleri</dt>
          <dd class="plain">{{ page.line.hours_text || 'Henüz paylaşılmadı' }}</dd>
          @if (payments()) {
            <dt>Ödeme</dt>
            <dd>{{ payments() }}</dd>
          }
          <dt>Nasıl durdurulur</dt>
          <dd class="plain">{{ page.line.hail_notes || 'Henüz paylaşılmadı' }}</dd>
          <dt>Son doğrulama</dt>
          <dd>
            {{
              page.line.last_verified_at ? date(page.line.last_verified_at) : 'Henüz doğrulanmadı'
            }}
          </dd>
          <dt>Katkıcı sayısı</dt>
          <dd>{{ page.line.contributor_count }}</dd>
          <dt>Sürüm</dt>
          <dd>{{ page.line.version_no }} · {{ date(page.line.published_at) }}</dd>
        </dl>
        <section class="actions" aria-label="Hat bağlantıları">
          <a rel="nofollow" [href]="links().contribute">Bu hattı düzelt</a>
          <a rel="nofollow" [href]="links().open">Uygulamada aç</a>
        </section>
        @if (page.city.is_sample) {
          <p>Bu şehirdeki veriler örnek veridir.</p>
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
    .code {
      font-weight: var(--iv-font-body-weight-600);
    }
    .summary {
      font-size: 1.125rem;
      line-height: 1.7;
    }
    svg {
      display: block;
      width: 100%;
      max-height: 24rem;
      background: var(--iv-color-krem);
      margin: 1.5rem 0;
    }
    section,
    dl {
      margin-top: 2rem;
    }
    li {
      padding: 0.5rem 0;
    }
    dt {
      font-weight: var(--iv-font-body-weight-600);
      margin-top: 1rem;
    }
    dd {
      margin: 0.25rem 0 0;
    }
    .plain {
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .actions a {
      padding: 0.75rem 1rem;
      border: 1px solid var(--iv-color-lacivert);
      border-radius: 0.25rem;
    }
  `,
})
export class LinePage extends PageView<LineData> {
  protected readonly mode = modeLabel;
  protected readonly date = formatTurkishDate;
  protected readonly fare = formatFare;
  protected readonly sketch = computed(() => {
    const page = this.data();
    return page.state === 'ok'
      ? projectLine(page.line.geometry.coordinates, page.line.stops)
      : null;
  });
  protected readonly summary = computed(() => {
    const page = this.data();
    return page.state === 'ok' ? buildLineSummary(page.line, page.city.name) : '';
  });
  protected readonly payments = computed(() => {
    const page = this.data();
    return page.state === 'ok'
      ? page.line.payment_methods
          .map(paymentLabel)
          .filter((value): value is string => value !== null)
          .join(', ')
      : '';
  });
  protected readonly links = computed(() => {
    const page = this.data();
    return page.state === 'ok'
      ? lineAppLinks(this.config.appOrigin, page.city.slug, page.line.slug)
      : { contribute: '', open: '' };
  });
  constructor() {
    super();
    this.connect(lineSeo, lineJsonLd);
  }
}
