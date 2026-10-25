import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { LineDetail } from '@inecekvar/data-access';
import { formatFare } from '@inecekvar/ui';
import {
  DestinationSignComponent,
  KeepCodesComponent,
  RouteSketchComponent,
  RouteStripComponent,
  StateComponent,
  StopSequenceComponent,
  StopSequenceItem,
  StripNode,
  TicketComponent,
} from '@inecekvar/ui';
import { CityStore } from '../city/city.store';
import { FavoritesStore } from '../core/favorites.store';
import { LanguageService } from '../core/language.service';
import { TPipe, TpPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { MapComponent } from '../map/map.component';
import { CatalogSource } from '../packs/catalog-source';
import { apiLineId, PACK_ID_PREFIX } from '../packs/pack-data';
import { PackRegistry } from '../packs/pack-registry';
import { BackButtonComponent } from '../shared/back-button.component';
import { ConnectivityService } from '../shared/connectivity.service';
import { formatDate, lineMode, localeOf } from '../shared/format';
import { detailFailure, detailRouteParams } from './detail-route';

const PAYMENT_KEYS: Record<string, TranslationKey> = {
  nakit: 'payment.nakit',
  kart: 'payment.kart',
  istanbulkart: 'payment.istanbulkart',
};

/**
 * `/hat/:slug?city=`: the destination sign, the strip diagram (or the map on request), the fare
 * ticket, hours, payment, hailing, the ordered stops and freshness.
 */
@Component({
  selector: 'iv-line-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    BackButtonComponent,
    IonTitle,
    IonContent,
    MapComponent,
    DestinationSignComponent,
    KeepCodesComponent,
    RouteSketchComponent,
    RouteStripComponent,
    StateComponent,
    StopSequenceComponent,
    TicketComponent,
    TPipe,
    TpPipe,
  ],
  templateUrl: './line.page.html',
  styleUrls: ['./band-sign.scss', './line.page.scss'],
})
export class LinePage {
  private readonly api = inject(CatalogSource);
  private readonly router = inject(Router);
  private readonly i18n = inject(LanguageService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly cities = inject(CityStore);
  protected readonly favorites = inject(FavoritesStore);
  protected readonly params = detailRouteParams();

  protected readonly line = resource({
    params: () => this.params(),
    loader: ({ params, abortSignal }) => this.api.line(params.slug, params.city, abortSignal),
  });

  protected readonly data = computed<LineDetail | null>(() =>
    this.line.hasValue() ? (this.line.value() ?? null) : null,
  );

  protected readonly view = computed(() => {
    if (!this.params()) return this.cities.restored() ? 'not-found' : 'loading';
    const error = this.line.error();
    if (error) return detailFailure(error, this.connectivity);
    return this.data() ? 'ready' : 'loading';
  });

  private readonly packs = inject(PackRegistry);
  /** The pack version when this page was read from the installed pack. */
  protected readonly packVersion = computed(() => {
    const city = this.params()?.city;
    const manifest = city ? this.packs.manifests().get(city) : undefined;
    return manifest && this.data()?.id.startsWith(PACK_ID_PREFIX)
      ? { version: manifest.packVersion }
      : null;
  });

  protected readonly mode = computed(() => lineMode(this.data()?.mode ?? ''));
  protected readonly modeLabel = computed(() => this.i18n.t(`mode.${this.mode()}`));
  protected readonly coordinates = computed(() => this.data()?.geometry.coordinates ?? []);
  protected readonly stopPoints = computed(() => this.data()?.stops.map((s) => s.location) ?? []);

  /** Diagram first; the interactive map loads only when asked for. */
  protected readonly display = signal<'diagram' | 'map'>('diagram');

  protected readonly ends = computed(() => {
    const stops = this.data()?.stops ?? [];
    const first = stops[0];
    const last = stops[stops.length - 1];
    return stops.length >= 2 && first && last ? { from: first.name, to: last.name } : null;
  });

  protected readonly stripNodes = computed<StripNode[]>(
    () =>
      this.data()?.stops.map((stop, index) => ({ name: stop.name, tick: String(index + 1) })) ?? [],
  );

  protected readonly diagramLabel = computed(() => {
    const line = this.data();
    const ends = this.ends();
    return line && ends
      ? this.i18n.t('line.diagramLabel', {
          code: line.code,
          count: line.stops.length,
          from: ends.from,
          to: ends.to,
        })
      : '';
  });

  protected readonly stopItems = computed<StopSequenceItem[]>(
    () =>
      this.data()?.stops.map((stop, index) => ({
        slug: stop.slug,
        name: stop.name,
        note: stop.kind === 'informal' ? this.i18n.t('stop.kindInformal') : undefined,
        tick: String(index + 1),
      })) ?? [],
  );

  protected readonly fare = computed(() => {
    const minor = this.data()?.fare_minor;
    if (minor === null || minor === undefined) return this.i18n.t('fare.unknown');
    return minor === 0 ? this.i18n.t('fare.free') : formatFare(minor, localeOf(this.i18n.lang()));
  });

  protected readonly fareNote = computed(() => {
    const date = formatDate(this.data()?.fare_updated_at, this.i18n.lang());
    return date ? this.i18n.t('line.fareUpdated', { date }) : this.i18n.t('line.fareNoDate');
  });
  protected readonly verifiedNote = computed(() => {
    const date = formatDate(this.data()?.last_verified_at, this.i18n.lang());
    return date ? this.i18n.t('line.lastVerified', { date }) : this.i18n.t('line.neverVerified');
  });

  /** Known methods are translated; anything else is shown as the stored text. */
  protected readonly payments = computed(() =>
    (this.data()?.payment_methods ?? []).map((method) => {
      const key = PAYMENT_KEYS[method.toLocaleLowerCase('tr')];
      return key ? this.i18n.t(key) : method;
    }),
  );

  protected readonly favorite = computed(() => {
    const line = this.data();
    const params = this.params();
    return !!line && !!params && this.favorites.has(params.city, line.slug);
  });

  protected toggleFavorite(): void {
    const line = this.data();
    const params = this.params();
    if (!line || !params) return;
    void this.favorites.toggle({
      city: params.city,
      slug: line.slug,
      code: line.code,
      name: line.name,
      mode: this.mode(),
      lineId: apiLineId(line.id),
    });
  }

  protected openStop(slug: string): void {
    const city = this.params()?.city;
    if (city) void this.router.navigate(['/durak', slug], { queryParams: { city } });
  }

  /** The contribution flow (package 3F) receives the line and city it is about. */
  protected reportChange(): void {
    const params = this.params();
    if (!params) return;
    void this.router.navigate(['/katki'], {
      queryParams: { hat: params.slug, city: params.city },
    });
  }

  protected retry(): void {
    this.line.reload();
  }

  protected toSearch(): void {
    void this.router.navigateByUrl('/ara');
  }
}
