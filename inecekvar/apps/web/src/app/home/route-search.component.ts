import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NoticeComponent, SIGN_TEXT_STYLES } from '@inecekvar/ui';
import { CityOut, isStopPairs, StopPairOut } from '../content/public-types';
import { routePairPath } from '../content/route-pair';
import { apiPath, PublicApiClient } from '../data/public-api.client';

@Component({
  selector: 'iv-route-search',
  imports: [RouterLink, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="search iv-board" (submit)="search($event)" aria-label="Hat ara">
      <p class="iv-sign-text">Nereden – Nereye</p>
      <label for="route-city">Şehir</label>
      <select id="route-city" required (change)="chooseCity($any($event.target).value)">
        <option value="">Şehrini seç</option>
        @for (city of cities(); track city.slug) {
          <option [value]="city.slug">{{ city.name }}</option>
        }
      </select>
      <label for="route-from">Nereden</label>
      <select
        id="route-from"
        required
        [disabled]="busy() || !pairs().length"
        [value]="from()"
        (change)="from.set($any($event.target).value); to.set('')"
      >
        <option value="">Kalkış durağı</option>
        @for (stop of origins(); track stop.slug) {
          <option [value]="stop.slug">{{ stop.name }}</option>
        }
      </select>
      <label for="route-to">Nereye</label>
      <select
        id="route-to"
        required
        [disabled]="!from()"
        [value]="to()"
        (change)="to.set($any($event.target).value)"
      >
        <option value="">Varış durağı</option>
        @for (pair of destinations(); track pair.to_stop.slug) {
          <option [value]="pair.to_stop.slug">{{ pair.to_stop.name }}</option>
        }
      </select>
      <button type="submit" [disabled]="!match()">Hatları bul</button>
      @if (busy()) {
        <span role="status">Duraklar yükleniyor…</span>
      }
      @if (failed()) {
        <iv-notice
          tone="error"
          message="Duraklar yüklenemedi. Şehri yeniden seçerek tekrar dene."
        />
      } @else if (city() && !busy() && !pairs().length) {
        <span role="status">Bu şehir için durak çifti henüz yok.</span>
      }
      @if (city()) {
        <a [routerLink]="['/', city(), 'hatlar']">Şehrin tüm hatları</a>
      }
      <small>Yayımlanmış durak çiftlerinde ara. Daha fazla rota için uygulamayı aç.</small>
      <noscript
        >Durak araması için JavaScript gerekir. Aşağıdaki şehir listesinden hatlara
        ulaşabilirsin.</noscript
      >
    </form>
  `,
  styles: [
    SIGN_TEXT_STYLES,
    `
      .search {
        display: grid;
        gap: 0.5rem;
        padding: clamp(1.25rem, 3vw, 2rem);
        border-bottom: 5px solid var(--iv-board-edge);
      }
      p {
        margin: 0 0 0.75rem;
        font-size: clamp(1.5rem, 4vw, 2.4rem);
        line-height: 1.1;
      }
      label {
        font-size: 0.9rem;
        font-weight: 600;
      }
      select {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        min-height: 48px;
        padding: 0.5rem;
        border: 1px solid var(--iv-board-line);
        border-radius: var(--iv-radius-xs);
        background: var(--iv-board-raised);
        color: var(--iv-board-ink);
        font: inherit;
      }
      button {
        min-height: 48px;
        margin-top: 0.75rem;
        border: 0;
        border-radius: var(--iv-radius-xs);
        background: var(--iv-accent);
        color: var(--iv-accent-ink);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      :disabled {
        opacity: 0.6;
        cursor: default;
      }
      select:focus-visible {
        outline: 3px solid var(--iv-info);
        outline-offset: 2px;
      }
      a,
      small,
      noscript,
      [role='status'] {
        font-size: 0.85rem;
      }
      small {
        color: var(--iv-board-muted);
      }
    `,
  ],
})
export class RouteSearchComponent {
  readonly cities = input.required<readonly CityOut[]>();
  protected readonly city = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly pairs = signal<StopPairOut[]>([]);
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  protected readonly origins = computed(() => [
    ...new Map(this.pairs().map((pair) => [pair.from_stop.slug, pair.from_stop])).values(),
  ]);
  protected readonly destinations = computed(() =>
    this.pairs().filter((pair) => pair.from_stop.slug === this.from()),
  );
  protected readonly match = computed(() =>
    this.destinations().find((pair) => pair.to_stop.slug === this.to()),
  );
  private readonly api = inject(PublicApiClient);
  private readonly router = inject(Router);
  private revision = 0;

  protected async chooseCity(city: string): Promise<void> {
    const revision = ++this.revision;
    this.city.set(city);
    this.from.set('');
    this.to.set('');
    this.pairs.set([]);
    this.failed.set(false);
    this.busy.set(!!city);
    if (!city) return;
    const result = await this.api.get(
      apiPath('/cities/{slug}/stop-pairs', { slug: city }),
      { limit: 200 },
      isStopPairs,
    );
    if (revision !== this.revision) return;
    this.busy.set(false);
    if (result.ok) this.pairs.set(result.data.pairs);
    else this.failed.set(true);
  }

  protected search(event: Event): void {
    event.preventDefault();
    const pair = this.match();
    if (pair) void this.router.navigateByUrl(routePairPath(this.city(), pair));
  }
}
