import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import {
  CatalogApi,
  ContributionApi,
  EditProposal,
  isApiError,
  LineDetail,
  LineListItem,
  StopDetail,
  StopSummary,
} from '@inecekvar/data-access';
import { FarePipe } from '@inecekvar/ui';
import { LicenceGate } from '../auth/licence-gate';
import { CityPickerComponent } from '../city/city-picker.component';
import { CityStore } from '../city/city.store';
import { RecorderStore } from '../contribute/recorder.store';
import { LngLat } from '../contribute/simplify';
import { LanguageService } from '../core/language.service';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { MapComponent } from '../map/map.component';
import { MapMarker } from '../map/map-style';
import { PhotoUploader } from '../proposals/photo-upload';
import {
  BOUNDS,
  Built,
  buildFareUpdate,
  buildNewLine,
  buildNewStop,
  buildRetire,
  buildUpdateLine,
  buildUpdateStop,
  emptyFields,
  FieldErrors,
  fieldsFromLine,
  fieldsFromStop,
  isProposalKind,
  KIND_LABELS,
  LINE_KINDS,
  LINE_MODES,
  Mode,
  PAYMENTS,
  PaymentMethod,
  PROPOSAL_KINDS,
  ProposalFields,
  ProposalKind,
} from '../proposals/proposal-form';
import { StopIndex } from '../search/stop-index';
import { BackButtonComponent } from '../shared/back-button.component';
import { Countdown } from '../shared/countdown';
import { fold, formatDate } from '../shared/format';
import { LOCATION_SOURCE } from '../shared/location';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MODE_LABELS: Record<Mode, TranslationKey> = {
  dolmus: 'mode.dolmus',
  minibus: 'mode.minibus',
  servis: 'mode.servis',
};

const PAYMENT_LABELS: Record<PaymentMethod, TranslationKey> = {
  nakit: 'payment.nakit',
  kart: 'payment.kart',
  istanbulkart: 'payment.istanbulkart',
};

/** Copy for a refused proposal. */
export function proposalFailure(error: unknown): TranslationKey {
  if (!isApiError(error)) return 'proposal.errors.generic';
  if (error.status === 429) return 'proposal.errors.rateLimited';
  if (error.kind === 'network' || error.kind === 'timeout') return 'proposal.errors.offline';
  switch (error.code) {
    case 'edit.no_change':
      return 'proposal.errors.noChange';
    case 'edit.outside_bbox':
      return 'proposal.errors.outsideCity';
    case 'edit.invalid_stops':
      return 'proposal.errors.invalidStops';
    case 'photo.not_found':
      return 'proposal.errors.photoPending';
    case 'trace.not_found':
    case 'trace.already_linked':
      return 'proposal.errors.traceUnavailable';
    case 'trace.too_short':
    case 'trace.invalid_geometry':
      return 'proposal.errors.traceTooShort';
    case 'line.not_found':
    case 'stop.not_found':
    case 'city.not_found':
      return 'proposal.errors.gone';
    case 'auth.forbidden':
      return 'proposal.errors.licence';
  }
  return error.status === 422 ? 'proposal.errors.invalid' : 'proposal.errors.generic';
}

/**
 * `/katki/oneri`: one form for the six proposal kinds (query `tur`). Updates start from the
 * published version and send only what changed. User text is shown as text only.
 */
@Component({
  selector: 'iv-proposal-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonTitle,
    IonContent,
    BackButtonComponent,
    CityPickerComponent,
    MapComponent,
    FarePipe,
    TPipe,
  ],
  templateUrl: './proposal.page.html',
  styleUrl: './proposal.page.scss',
})
export class ProposalPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogApi);
  private readonly contributions = inject(ContributionApi);
  private readonly licence = inject(LicenceGate);
  private readonly stopIndex = inject(StopIndex);
  private readonly locator = inject(LOCATION_SOURCE);
  private readonly recorder = inject(RecorderStore);
  private readonly i18n = inject(LanguageService);
  protected readonly cities = inject(CityStore);
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly photo = new PhotoUploader();
  protected readonly countdown = new Countdown();
  protected readonly kinds = PROPOSAL_KINDS.map((kind) => ({ kind, label: KIND_LABELS[kind] }));
  protected readonly modeOptions = LINE_MODES.map((mode) => ({ mode, label: MODE_LABELS[mode] }));
  protected readonly paymentOptions = PAYMENTS.map((method) => ({
    method,
    label: PAYMENT_LABELS[method],
  }));
  protected readonly bounds = BOUNDS;

  protected readonly kind = computed<ProposalKind | null>(() => {
    const value = this.query()?.get('tur');
    return isProposalKind(value) ? value : null;
  });
  protected readonly city = computed(() => {
    const value = this.query()?.get('city');
    return value && SLUG.test(value) ? value : this.cities.selectedSlug();
  });
  protected readonly cityInfo = computed(
    () => this.cities.cities().find((c) => c.slug === this.city()) ?? null,
  );
  protected readonly aboutLine = computed(() => {
    const kind = this.kind();
    return kind !== null && LINE_KINDS.includes(kind);
  });
  protected readonly aboutStop = computed(
    () => this.kind() === 'new_stop' || this.kind() === 'update_stop',
  );

  protected readonly fields = signal<ProposalFields>(emptyFields());
  protected readonly errors = signal<FieldErrors>({});
  protected readonly line = signal<LineDetail | null>(null);
  protected readonly stop = signal<StopDetail | null>(null);
  protected readonly target = signal<'idle' | 'loading' | 'error'>('idle');
  protected readonly busy = signal(false);
  protected readonly submitError = signal<TranslationKey | null>(null);
  protected readonly locating = signal(false);
  protected readonly locateError = signal<TranslationKey | null>(null);

  protected readonly lineSearch = signal('');
  protected readonly lineResults = signal<LineListItem[]>([]);
  protected readonly stopSearch = signal('');
  protected readonly stopResults = signal<StopSummary[]>([]);
  /** Names of the stops chosen for a new line, by id. */
  private readonly stopNames = signal<Record<string, string>>({});
  private searchRun = 0;

  protected readonly chosenStops = computed(() =>
    this.fields().stopIds.map((id) => ({ id, name: this.stopNames()[id] ?? id })),
  );
  protected readonly fareDate = computed(() =>
    formatDate(this.line()?.fare_updated_at, this.i18n.lang()),
  );
  protected readonly today = computed(() => formatDate(new Date().toISOString(), this.i18n.lang()));
  protected readonly locationMarker = computed<MapMarker[]>(() => {
    const at = this.fields().location;
    return at ? [{ kind: 'to', at }] : [];
  });
  protected readonly photoKind = computed(() => (this.aboutStop() ? 'stop_sign' : 'fare_table'));
  protected readonly photoStep = computed(() => {
    const state = this.photo.state();
    return state.status === 'uploading' ? state.step : null;
  });
  protected readonly photoBusy = computed(() => this.photo.state().status === 'uploading');

  constructor() {
    void this.cities.init();
    effect(() => {
      const kind = this.kind();
      const query = this.query();
      const city = this.city();
      untracked(() => void this.prepare(kind, city, query));
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setField<K extends keyof ProposalFields>(key: K, value: ProposalFields[K]): void {
    this.fields.update((f) => ({ ...f, [key]: value }));
    if (this.errors()[key])
      this.errors.update((e) => ({ ...e, [key]: undefined, form: undefined }));
  }

  protected chooseKind(kind: ProposalKind): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tur: kind },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected togglePayment(method: PaymentMethod): void {
    const current = this.fields().payments;
    this.setField(
      'payments',
      current.includes(method) ? current.filter((m) => m !== method) : [...current, method],
    );
  }

  protected async searchLines(text: string): Promise<void> {
    this.lineSearch.set(text);
    const city = this.city();
    const run = ++this.searchRun;
    if (!city || text.trim().length < 1) {
      this.lineResults.set([]);
      return;
    }
    try {
      const lines = await this.catalog.lines({ city, q: text.trim(), limit: 8 });
      if (run === this.searchRun) this.lineResults.set(lines);
    } catch {
      if (run === this.searchRun) this.lineResults.set([]);
    }
  }

  protected chooseLine(slug: string): void {
    this.lineResults.set([]);
    this.lineSearch.set('');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { hat: slug, city: this.city() },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected async searchStops(text: string): Promise<void> {
    this.stopSearch.set(text);
    const city = this.cityInfo();
    const run = ++this.searchRun;
    const needle = fold(text);
    if (!city || needle.length < 2) {
      this.stopResults.set([]);
      return;
    }
    try {
      // The API list, not the offline pack: proposals need the stops' real ids.
      const stops = await this.stopIndex.stopsOf(city);
      if (run !== this.searchRun) return;
      this.stopResults.set(
        stops
          .filter((s) => !s.id.startsWith('pack:'))
          .filter((s) => fold(s.name).includes(needle))
          .slice(0, 8),
      );
    } catch {
      if (run === this.searchRun) this.stopResults.set([]);
    }
  }

  protected addStop(stop: StopSummary): void {
    this.stopResults.set([]);
    this.stopSearch.set('');
    if (this.kind() === 'update_stop') {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { durak: stop.slug, city: this.city() },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      return;
    }
    if (this.fields().stopIds.length >= BOUNDS.maxStops) return;
    this.stopNames.update((names) => ({ ...names, [stop.id]: stop.name }));
    this.setField('stopIds', [...this.fields().stopIds.filter((id) => id !== stop.id), stop.id]);
  }

  protected moveStop(index: number, delta: -1 | 1): void {
    const ids = [...this.fields().stopIds];
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to] as string, ids[index] as string];
    this.setField('stopIds', ids);
  }

  protected removeStop(index: number): void {
    this.setField(
      'stopIds',
      this.fields().stopIds.filter((_, i) => i !== index),
    );
  }

  protected async useMyLocation(): Promise<void> {
    this.locating.set(true);
    this.locateError.set(null);
    const result = await this.locator.locate();
    this.locating.set(false);
    if (result.kind === 'ok') this.setField('location', [result.lng, result.lat]);
    else
      this.locateError.set(
        result.kind === 'denied' ? 'proposal.locationDenied' : 'proposal.locationUnavailable',
      );
  }

  protected picked(at: [number, number]): void {
    this.setField('location', [at[0], at[1]]);
  }

  protected async choosePhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the input so choosing the same file again still triggers a change.
    input.value = '';
    if (file) await this.photo.choose(file, this.photoKind());
  }

  protected removePhoto(): void {
    this.photo.clear();
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || this.photoBusy()) return;
    this.submitError.set(null);
    const built = this.build();
    if (!built) return;
    if (!built.ok) {
      this.errors.set(built.errors);
      return;
    }
    this.errors.set({});
    if (!(await this.licence.ensure())) return;
    this.busy.set(true);
    try {
      await this.send(built.proposal);
      await this.router.navigate(['/katki/onerilerim'], {
        queryParams: { yeni: 1 },
        replaceUrl: true,
      });
    } catch (error) {
      this.submitError.set(proposalFailure(error));
      if (isApiError(error) && error.status === 429) this.countdown.start(error.retryAfterSeconds);
    } finally {
      this.busy.set(false);
    }
  }

  private async send(proposal: EditProposal): Promise<void> {
    try {
      await this.contributions.proposeEdit(proposal);
    } catch (error) {
      if (!isApiError(error) || error.status !== 403 || !(await this.licence.recheck()))
        throw error;
      await this.contributions.proposeEdit(proposal);
    }
  }

  private build(): Built | null {
    const kind = this.kind();
    const city = this.city();
    const fields = { ...this.fields(), photoId: this.photo.photoId() };
    const bbox = this.cityInfo()?.bbox ?? null;
    const line = this.line();
    const stop = this.stop();
    switch (kind) {
      case 'new_line':
        return city ? buildNewLine(city, fields) : this.missing('proposal.errors.city');
      case 'update_line':
        return line ? buildUpdateLine(line, fields) : this.missing('proposal.errors.line');
      case 'fare_update':
        return line ? buildFareUpdate(line, fields) : this.missing('proposal.errors.line');
      case 'retire':
        return line ? buildRetire(line, fields) : this.missing('proposal.errors.line');
      case 'new_stop':
        return city ? buildNewStop(city, bbox, fields) : this.missing('proposal.errors.city');
      case 'update_stop':
        return stop ? buildUpdateStop(stop, bbox, fields) : this.missing('proposal.errors.stop');
      default:
        return null;
    }
  }

  private missing(key: TranslationKey): Built {
    return { ok: false, errors: { form: key } };
  }

  private async prepare(
    kind: ProposalKind | null,
    city: string | null,
    query: ReturnType<typeof this.query>,
  ): Promise<void> {
    this.errors.set({});
    this.submitError.set(null);
    this.line.set(null);
    this.stop.set(null);
    this.target.set('idle');
    const trace = query?.get('iz');
    const base: ProposalFields = {
      ...emptyFields(),
      traceId: trace && UUID.test(trace) ? trace : null,
    };
    this.fields.set(base);
    if (!kind || !city) return;
    const lineSlug = query?.get('hat');
    const stopSlug = query?.get('durak');
    if (LINE_KINDS.includes(kind) && lineSlug && SLUG.test(lineSlug)) {
      this.target.set('loading');
      try {
        // Always the API: the update must be based on the current published version.
        const line = await this.catalog.line(lineSlug, city);
        if (this.kind() !== kind) return;
        this.line.set(line);
        this.fields.set({ ...fieldsFromLine(line), traceId: base.traceId });
        if (kind === 'fare_update') this.fields.update((f) => ({ ...f, fare: '' }));
        this.target.set('idle');
      } catch {
        this.target.set('error');
      }
    } else if (kind === 'update_stop' && stopSlug && SLUG.test(stopSlug)) {
      this.target.set('loading');
      try {
        const stop = await this.catalog.stop(stopSlug, city);
        if (this.kind() !== kind) return;
        this.stop.set(stop);
        this.fields.set(fieldsFromStop(stop));
        this.target.set('idle');
      } catch {
        this.target.set('error');
      }
    } else if (kind === 'new_stop') {
      const index = Number(query?.get('isaret'));
      const marked = Number.isInteger(index) ? this.recorder.uploadedStops()[index] : undefined;
      if (marked) {
        const at: LngLat = [marked.at[0], marked.at[1]];
        this.fields.set({ ...base, location: at, stopName: marked.name ?? '' });
      }
    }
  }
}
