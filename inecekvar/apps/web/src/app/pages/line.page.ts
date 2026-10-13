import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cityCrumbs, stopNode } from '../content/page-breadcrumbs';
import { LineData } from '../content/page-data';
import { formatFare, formatTurkishDate } from '../content/format';
import { buildLineSummary } from '../content/line-summary';
import { lineDescription, lineSubject } from '../content/page-text';
import { PageView } from '../content/page-view';
import { modeLabel, paymentLabel } from '../content/public-types';
import { LineMapComponent } from '../map/line-map.component';
import { SiteFooterComponent } from '../home/site-footer.component';
import { SiteHeaderComponent } from '../home/site-header.component';
import {
  DestinationSignComponent,
  KeepCodesComponent,
  RouteStripComponent,
  StopSequenceComponent,
  StopSequenceItem,
  StripNode,
} from '@inecekvar/ui';
import { breadcrumbList, busTrip, JsonLdNode, organization } from '../seo/json-ld';
import { PageSeo } from '../seo/seo';
import { StatusPageComponent } from './status-page.component';

export function lineSeo({ city, line }: LineData): PageSeo {
  return {
    title: lineSubject(line.name, line.mode),
    description: lineDescription(line, city.name),
    path: `/${city.slug}/hat/${line.slug}`,
    ogType: 'article',
    // The image route serves no sample-city lines, so their pages name no image.
    ...(city.is_sample ? {} : { ogImagePath: `/og/${city.slug}/hat/${line.slug}.svg` }),
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
  imports: [
    RouterLink,
    StatusPageComponent,
    LineMapComponent,
    SiteHeaderComponent,
    SiteFooterComponent,
    DestinationSignComponent,
    RouteStripComponent,
    StopSequenceComponent,
    KeepCodesComponent,
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
          <a [routerLink]="['/', page.city.slug, 'hatlar']">Hatlar</a>
        </p>
        <div class="layout">
          <div class="main-col">
            <iv-destination-sign
              class="sign"
              [code]="page.line.code"
              [mode]="mode(page.line.mode)"
              [from]="ends()?.from ?? ''"
              [to]="ends()?.to ?? ''"
              fromLabel="Kalkış"
              toLabel="Son durak"
            >
              <h1><iv-keep-codes [text]="page.line.name" /> {{ mode(page.line.mode) }} hattı</h1>
            </iv-destination-sign>
            <p class="code">Hat kodu: {{ page.line.code }}</p>
            <p class="summary">{{ summary() }}</p>
            @if (page.city.is_sample) {
              <p class="sample">
                <span class="iv-tape">örnek veri</span> Bu şehirdeki veriler örnek veridir.
              </p>
            }
            <section class="diagram" aria-labelledby="diagram-title">
              <h2 id="diagram-title">Hat şeması</h2>
              @if (strip().length > 1) {
                <iv-route-strip [nodes]="strip()" [label]="diagramLabel()" [fit]="560" />
                <p class="note">Şema durak sırasını gösterir, mesafeyi değil.</p>
              } @else {
                <p>Güzergâh çizimi henüz yok.</p>
              }
            </section>
          </div>
          <aside class="side" aria-label="Hat bilgileri">
            <dl class="facts">
              <div class="fare">
                <dt>Ücret</dt>
                <dd>
                  @if (fare(page.line.fare_minor); as price) {
                    <span class="amount">{{ price }}</span>
                    @if (page.line.fare_updated_at; as updated) {
                      <span class="when"> · son güncelleme: {{ date(updated) }}</span>
                    }
                  } @else {
                    Henüz paylaşılmadı
                  }
                </dd>
              </div>
              <div>
                <dt>Çalışma saatleri</dt>
                <dd class="plain">{{ page.line.hours_text || 'Henüz paylaşılmadı' }}</dd>
              </div>
              @if (payments()) {
                <div>
                  <dt>Ödeme</dt>
                  <dd>{{ payments() }}</dd>
                </div>
              }
              <div class="hail">
                <dt>Nasıl durdurulur</dt>
                <dd class="plain">{{ page.line.hail_notes || 'Henüz paylaşılmadı' }}</dd>
              </div>
              <div>
                <dt>Son doğrulama</dt>
                <dd>
                  {{
                    page.line.last_verified_at
                      ? date(page.line.last_verified_at)
                      : 'Henüz doğrulanmadı'
                  }}
                </dd>
              </div>
              <div class="small">
                <dt>Katkıcı sayısı</dt>
                <dd>{{ page.line.contributor_count }}</dd>
              </div>
              <div class="small">
                <dt>Sürüm</dt>
                <dd>{{ page.line.version_no }} · {{ date(page.line.published_at) }}</dd>
              </div>
            </dl>
            <section class="actions" aria-label="Hat bağlantıları">
              <a class="iv-cta iv-cta--ghost" rel="nofollow" [href]="links().contribute"
                >Bu hattı düzelt</a
              >
              <a class="iv-cta" rel="nofollow" [href]="links().open">Uygulamada aç</a>
            </section>
            <section class="map" aria-label="Harita">
              <iv-line-map [line]="page.line" [city]="page.city.slug" />
            </section>
          </aside>
          <section class="stops" aria-labelledby="stops-title">
            <h2 id="stops-title">
              Duraklar <small>{{ page.line.stops.length }} durak</small>
            </h2>
            <iv-stop-sequence [stops]="stopItems()" label="Duraklar, sırasıyla" />
          </section>
        </div>
      </main>
      <iv-site-footer />
    } @else if (page.state === 'not_found') {
      <iv-status-page kind="not-found" />
    } @else {
      <iv-status-page kind="unavailable" />
    }
  `,
  styles: `
    .layout {
      display: grid;
      gap: 2rem;
      padding-top: 1rem;
    }
    .layout > * {
      min-width: 0;
    }
    @media (min-width: 60rem) {
      .layout {
        grid-template-columns: minmax(0, 1fr) 21.5rem;
        gap: 3rem;
        align-items: start;
      }
      .main-col {
        grid-column: 1;
        grid-row: 1;
      }
      .side {
        grid-column: 2;
        grid-row: 1 / span 2;
        position: sticky;
        top: 1.5rem;
      }
      .stops {
        grid-column: 1;
        grid-row: 2;
      }
    }
    .sign {
      margin: 0 -0.5rem;
    }
    h1 {
      margin: 1rem 0 0;
      font-size: clamp(1.7rem, 4.2vw, 2.6rem);
      line-height: 1.08;
      letter-spacing: -0.02em;
      color: var(--iv-board-ink);
      overflow-wrap: anywhere;
    }
    .code {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .summary {
      max-width: var(--iv-measure);
      margin: 1.5rem 0 0;
      font-size: 1.2rem;
      line-height: 1.6;
    }
    .sample {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.95rem;
      color: var(--iv-ink-muted);
    }
    h2 {
      display: flex;
      align-items: baseline;
      gap: 0.75rem;
      margin: 0 0 0.75rem;
      font-size: 1.45rem;
      letter-spacing: -0.01em;
    }
    h2 small {
      font-family: var(--iv-font-body);
      font-size: 0.9rem;
      font-weight: 500;
      color: var(--iv-ink-muted);
    }
    .diagram {
      margin-top: 2.25rem;
      padding: 1.25rem 1rem 0.75rem;
      border-radius: 1.25rem;
      background: var(--iv-surface);
      border: 1px solid var(--iv-line);
    }
    .note {
      margin: 0.25rem 0 0;
      font-size: 0.85rem;
      color: var(--iv-ink-muted);
    }
    .stops {
      margin-top: 0.25rem;
    }
    .facts {
      display: grid;
      gap: 0.6rem;
      margin: 0;
    }
    .facts > div {
      padding: 0.85rem 1rem;
      border-radius: 0.9rem;
      background: var(--iv-surface);
      border: 1px solid var(--iv-line);
    }
    dt {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--iv-ink-muted);
    }
    dd {
      margin: 0.15rem 0 0;
      font-weight: 500;
    }
    .facts > .fare {
      --cut: 4.25rem;
      position: relative;
      padding: 1rem 1rem 1rem calc(var(--cut) + 1rem);
      border: 0;
      background: var(--iv-ticket);
      color: var(--iv-ticket-ink);
      -webkit-mask:
        radial-gradient(circle at var(--cut) 0, transparent 8px, #000 8.5px) top / 100% 51%
          no-repeat,
        radial-gradient(circle at var(--cut) 100%, transparent 8px, #000 8.5px) bottom / 100% 51%
          no-repeat;
      mask:
        radial-gradient(circle at var(--cut) 0, transparent 8px, #000 8.5px) top / 100% 51%
          no-repeat,
        radial-gradient(circle at var(--cut) 100%, transparent 8px, #000 8.5px) bottom / 100% 51%
          no-repeat;
    }
    .fare::before {
      content: '';
      position: absolute;
      left: var(--cut);
      top: 0.75rem;
      bottom: 0.75rem;
      border-left: 2px dashed rgba(20, 33, 61, 0.45);
    }
    .fare dt {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: var(--cut);
      display: grid;
      place-items: center;
      color: inherit;
      font-family: var(--iv-font-display);
      font-size: 0.75rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
    }
    .amount {
      display: block;
      font-family: var(--iv-font-display);
      font-weight: 700;
      font-size: 2rem;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .when {
      font-size: 0.9rem;
    }
    .facts > .hail {
      border-left: 5px solid var(--iv-signal);
    }
    .facts > .small {
      padding-block: 0.55rem;
      font-size: 0.95rem;
    }
    .plain {
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .actions {
      display: grid;
      gap: 0.75rem;
      margin-top: 1.25rem;
    }
    .map {
      margin-top: 1.25rem;
    }
  `,
})
export class LinePage extends PageView<LineData> {
  protected readonly mode = modeLabel;
  protected readonly date = formatTurkishDate;
  protected readonly fare = formatFare;
  protected readonly ends = computed(() => {
    const page = this.data();
    if (page.state !== 'ok') return null;
    const stops = page.line.stops;
    const first = stops[0];
    const last = stops[stops.length - 1];
    return stops.length >= 2 && first && last ? { from: first.name, to: last.name } : null;
  });
  protected readonly strip = computed<StripNode[]>(() => {
    const page = this.data();
    return page.state === 'ok'
      ? page.line.stops.map((stop, index) => ({ name: stop.name, tick: String(index + 1) }))
      : [];
  });
  protected readonly diagramLabel = computed(() => {
    const page = this.data();
    const ends = this.ends();
    return page.state === 'ok' && ends
      ? `${page.line.code} hat şeması: ${page.line.stops.length} durak, ${ends.from} → ${ends.to}`
      : '';
  });
  protected readonly stopItems = computed<StopSequenceItem[]>(() => {
    const page = this.data();
    if (page.state !== 'ok') return [];
    return page.line.stops.map((stop, index) => ({
      slug: stop.slug,
      name: stop.name,
      link: ['/', page.city.slug, 'durak', stop.slug],
      note: stop.kind === 'informal' ? 'İşaretsiz durak' : undefined,
      tick: String(index + 1),
    }));
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
