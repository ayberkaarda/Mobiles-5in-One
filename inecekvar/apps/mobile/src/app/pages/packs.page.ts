import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { City } from '@inecekvar/data-access';
import { NoticeComponent, ProgressBarComponent, StateComponent } from '@inecekvar/ui';
import { CityStore } from '../city/city.store';
import { LanguageService } from '../core/language.service';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { PackFailureKind, PackJob, PackManager } from '../packs/pack-manager';
import { PackRegistry } from '../packs/pack-registry';
import { BackButtonComponent } from '../shared/back-button.component';
import { formatBytes, formatDate } from '../shared/format';

const FAILURE_KEYS: Record<Exclude<PackFailureKind, 'entitlement'>, TranslationKey> = {
  rate_limited: 'packs.failRateLimited',
  offline: 'packs.failOffline',
  quota: 'packs.failQuota',
  integrity: 'packs.failIntegrity',
  invalid: 'packs.failInvalid',
  error: 'packs.failError',
};

const PHASE_KEYS: Record<PackJob['phase'], TranslationKey> = {
  dataset: 'packs.phaseDataset',
  basemap: 'packs.phaseBasemap',
  saving: 'packs.phaseSaving',
};

/**
 * `/ayarlar/cevrimdisi`: every city with its pack state. Download with progress and cancel,
 * update when the city's `pack_version` moved on, delete with a second tap, storage used and
 * left. The free city and Plus are decided by the API; a refusal is explained here.
 */
@Component({
  selector: 'iv-packs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonTitle,
    IonContent,
    BackButtonComponent,
    NoticeComponent,
    ProgressBarComponent,
    StateComponent,
    TPipe,
  ],
  templateUrl: './packs.page.html',
  styleUrl: './packs.page.scss',
})
export class PacksPage {
  private readonly i18n = inject(LanguageService);
  protected readonly cityStore = inject(CityStore);
  protected readonly registry = inject(PackRegistry);
  protected readonly manager = inject(PackManager);
  /** City whose delete button was tapped once. */
  protected readonly confirming = signal<string | null>(null);
  protected readonly plusInfo = signal<string | null>(null);

  /** Cities from the API (or the installed packs offline), plus packs of cities no longer listed. */
  protected readonly cities = computed<City[]>(() => {
    const listed = this.cityStore.cities();
    const known = new Set(listed.map((c) => c.slug));
    const orphans = this.registry
      .list()
      .filter((m) => !known.has(m.city))
      .map<City>((m) => ({
        name: m.name,
        slug: m.city,
        is_sample: m.isSample,
        bbox: m.bbox,
        centroid: m.centroid,
        timezone: m.timezone,
        pack_version: m.packVersion,
        published_line_count: m.lineCount,
      }));
    return [...listed, ...orphans];
  });

  protected readonly storageUsed = computed(() => {
    const estimate = this.manager.estimate();
    return this.size(estimate?.packs ?? 0);
  });

  protected readonly storageFree = computed(() => {
    const estimate = this.manager.estimate();
    if (!estimate || estimate.quota === null || estimate.usage === null) return null;
    return this.size(Math.max(0, estimate.quota - estimate.usage));
  });

  protected readonly storageWhere = computed<TranslationKey>(
    () => `packs.storageWhere.${this.registry.kind}` as TranslationKey,
  );

  constructor() {
    void this.cityStore.init();
    void this.registry.ready().then(() => this.manager.refreshEstimate());
  }

  ionViewWillEnter(): void {
    void this.cityStore.init().then(() => this.cityStore.load());
    void this.registry.refresh();
  }

  protected installedText(city: City): string | null {
    const manifest = this.registry.manifests().get(city.slug);
    if (!manifest) return null;
    return this.i18n.t('packs.installed', {
      version: manifest.packVersion,
      size: this.size(manifest.dataset.bytes + (manifest.basemap?.bytes ?? 0)),
      date: formatDate(manifest.installedAt, this.i18n.lang()) ?? '',
    });
  }

  protected hasBasemap(city: City): boolean {
    return !!this.registry.manifests().get(city.slug)?.basemap;
  }

  protected updateText(city: City): string {
    const manifest = this.registry.manifests().get(city.slug);
    return this.i18n.t('packs.updateAvailable', {
      from: manifest?.packVersion ?? 0,
      to: city.pack_version,
    });
  }

  protected job(city: City): PackJob | null {
    return this.manager.jobs().get(city.slug) ?? null;
  }

  protected phaseKey(job: PackJob): TranslationKey {
    return PHASE_KEYS[job.phase];
  }

  protected fraction(job: PackJob): number | null {
    return job.total ? job.received / job.total : null;
  }

  protected progressText(job: PackJob): string {
    if (job.phase === 'saving') return '';
    const received = this.size(job.received);
    return job.total
      ? this.i18n.t('packs.progress', { received, total: this.size(job.total) })
      : this.i18n.t('packs.progressUnknown', { received });
  }

  protected failure(city: City): PackFailureKind | null {
    return this.manager.failures().get(city.slug)?.kind ?? null;
  }

  protected failureKey(kind: PackFailureKind): TranslationKey {
    return kind === 'entitlement' ? 'packs.failEntitlementBody' : FAILURE_KEYS[kind];
  }

  protected download(city: City): void {
    this.confirming.set(null);
    void this.manager.download(city.slug);
  }

  protected cancel(city: City): void {
    this.manager.cancel(city.slug);
  }

  protected remove(city: City): void {
    if (this.confirming() !== city.slug) {
      this.confirming.set(city.slug);
      return;
    }
    this.confirming.set(null);
    void this.manager.remove(city.slug);
  }

  /** Plus arrives with the paywall package; until then the button says so. */
  protected showPlus(city: City): void {
    this.plusInfo.set(city.slug);
  }

  protected retryList(): void {
    void this.cityStore.load();
  }

  private size(bytes: number): string {
    return formatBytes(bytes, this.i18n.lang());
  }
}
