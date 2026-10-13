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
import { StopDetail } from '@inecekvar/data-access';
import { RouteSketchComponent, StateComponent, StopSignComponent } from '@inecekvar/ui';
import { CityStore } from '../city/city.store';
import { TPipe, TpPipe } from '../i18n/i18n';
import { MapComponent } from '../map/map.component';
import { CatalogSource } from '../packs/catalog-source';
import { BackButtonComponent } from '../shared/back-button.component';
import { ConnectivityService } from '../shared/connectivity.service';
import { lineMode } from '../shared/format';
import { LineItem, LineListComponent } from '../shared/line-list.component';
import { detailFailure, detailRouteParams } from './detail-route';

/** `/durak/:slug?city=`: where the stop is and which published lines serve it. */
@Component({
  selector: 'iv-stop-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    BackButtonComponent,
    IonTitle,
    IonContent,
    LineListComponent,
    MapComponent,
    RouteSketchComponent,
    StateComponent,
    StopSignComponent,
    TPipe,
    TpPipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <iv-back-button />
        </ion-buttons>
        <ion-title>{{ data()?.name ?? '' }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="iv-page">
        @switch (view()) {
          @case ('loading') {
            <p class="iv-note" role="status">{{ 'stop.loading' | t }}</p>
          }
          @case ('not-found') {
            <iv-state
              kind="error"
              [heading]="'stop.notFoundTitle' | t"
              [message]="'stop.notFoundBody' | t"
              [actionLabel]="'line.toSearch' | t"
              (action)="toSearch()"
            />
          }
          @case ('offline') {
            <iv-state
              kind="offline"
              [heading]="'search.offlineTitle' | t"
              [message]="'search.offlineBody' | t"
              [actionLabel]="'line.retry' | t"
              (action)="stop.reload()"
            />
          }
          @case ('error') {
            <iv-state
              kind="error"
              [heading]="'stop.errorTitle' | t"
              [message]="'line.errorBody' | t"
              [actionLabel]="'line.retry' | t"
              (action)="stop.reload()"
            />
          }
          @case ('ready') {
            @if (data(); as stop) {
              <iv-stop-sign class="hero">
                <p class="iv-kicker">
                  {{ (stop.kind === 'informal' ? 'stop.kindInformal' : 'stop.kindFormal') | t }}
                </p>
                <h1 class="iv-heading">{{ stop.name }}</h1>
              </iv-stop-sign>
              @if (!showMap()) {
                <button
                  type="button"
                  class="iv-button iv-button--board iv-button--block map-open"
                  (click)="showMap.set(true)"
                >
                  {{ 'planner.mapShow' | t }}
                </button>
              } @else {
                <div class="map">
                  @defer (on immediate) {
                    <iv-map
                      [stops]="points()"
                      [city]="params()?.city ?? null"
                      [label]="'stop.mapLabel' | t: { name: stop.name }"
                    />
                  } @placeholder {
                    <iv-route-sketch
                      class="sketch"
                      [stops]="points()"
                      [label]="'stop.mapLabel' | t: { name: stop.name }"
                    />
                  }
                </div>
              }
              <section class="iv-section">
                <h2 class="iv-section-title">
                  {{ 'stop.linesTitle' | t }}
                  <small>{{ 'search.lineCount' | tp: lines().length }}</small>
                </h2>
                @if (lines().length > 0) {
                  <iv-line-list [lines]="lines()" />
                } @else {
                  <p class="iv-note">{{ 'stop.linesEmpty' | t }}</p>
                }
              </section>
              <button
                type="button"
                class="iv-button iv-button--block report"
                (click)="reportChange()"
              >
                {{ 'stop.report' | t }}
              </button>
            }
          }
        }
      </div>
    </ion-content>
  `,
  styles: `
    .hero {
      margin: 0 calc(-1 * var(--iv-space-2));
    }
    .hero .iv-kicker {
      color: var(--iv-board-muted);
    }
    .hero .iv-kicker::before {
      box-shadow: 0 0 0 2.5px var(--iv-board-ink);
    }
    .hero .iv-heading {
      font-size: 28px;
      color: var(--iv-board-sign);
      text-shadow: var(--iv-board-glow);
    }
    .map,
    .map-open {
      margin-top: var(--iv-space-4);
    }
    .sketch {
      height: 220px;
      overflow: hidden;
      border: 1px solid var(--iv-line);
      border-radius: var(--iv-radius-m);
    }
    .iv-heading {
      overflow-wrap: anywhere;
    }
    .report {
      margin-top: var(--iv-space-5);
    }
  `,
})
export class StopPage {
  private readonly api = inject(CatalogSource);
  private readonly router = inject(Router);
  private readonly connectivity = inject(ConnectivityService);
  private readonly cities = inject(CityStore);
  protected readonly params = detailRouteParams();

  protected readonly stop = resource({
    params: () => this.params(),
    loader: ({ params, abortSignal }) => this.api.stop(params.slug, params.city, abortSignal),
  });

  protected readonly data = computed<StopDetail | null>(() =>
    this.stop.hasValue() ? (this.stop.value() ?? null) : null,
  );

  protected readonly view = computed(() => {
    if (!this.params()) return this.cities.restored() ? 'not-found' : 'loading';
    const error = this.stop.error();
    if (error) return detailFailure(error, this.connectivity);
    return this.data() ? 'ready' : 'loading';
  });

  /** A lone stop on an empty map says little; the map opens on request. */
  protected readonly showMap = signal(false);

  protected readonly points = computed(() => {
    const stop = this.data();
    return stop ? [stop.location] : [];
  });

  protected readonly lines = computed<LineItem[]>(() => {
    const city = this.params()?.city ?? '';
    return (this.data()?.lines ?? []).map((line) => ({
      city,
      slug: line.slug,
      code: line.code,
      name: line.name,
      mode: lineMode(line.mode),
    }));
  });

  protected toSearch(): void {
    void this.router.navigateByUrl('/ara');
  }

  /** Opens the stop update proposal (package 3F) for this stop. */
  protected reportChange(): void {
    const params = this.params();
    if (!params) return;
    void this.router.navigate(['/katki/oneri'], {
      queryParams: { tur: 'update_stop', durak: params.slug, city: params.city },
    });
  }
}
