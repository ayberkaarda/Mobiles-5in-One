import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { NoticeComponent } from '@inecekvar/ui';
import { CityPickerComponent } from '../city/city-picker.component';
import { CityStore } from '../city/city.store';
import { RecorderProblem, RecorderStore, ReviewIssue } from '../contribute/recorder.store';
import { MAX_STOP_NAME } from '../contribute/trace-draft';
import { LanguageService } from '../core/language.service';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { MapComponent } from '../map/map.component';
import { MapMarker } from '../map/map-style';
import { BackButtonComponent } from '../shared/back-button.component';
import { Countdown } from '../shared/countdown';
import { formatDate } from '../shared/format';

const ISSUES: Record<ReviewIssue, TranslationKey> = {
  'too-few': 'recorder.issueTooFew',
  'outside-city': 'recorder.issueOutside',
  'too-long-time': 'recorder.issueTooLongTime',
  'too-long-distance': 'recorder.issueTooLongDistance',
};

const PROBLEMS: Record<RecorderProblem, TranslationKey> = {
  denied: 'recorder.problem.denied',
  unavailable: 'recorder.problem.unavailable',
  storage: 'recorder.problem.storage',
};

/** `/katki/kayit`: record a ride, mark stops, review on the map, then send (user story 5). */
@Component({
  selector: 'iv-recorder-page',
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
    NoticeComponent,
    TPipe,
  ],
  templateUrl: './recorder.page.html',
  styleUrl: './recorder.page.scss',
})
export class RecorderPage {
  protected readonly rec = inject(RecorderStore);
  protected readonly cities = inject(CityStore);
  private readonly i18n = inject(LanguageService);
  private readonly router = inject(Router);

  protected readonly countdown = new Countdown();
  protected readonly nameMax = MAX_STOP_NAME;
  /** Name typed for the stop that was just marked. */
  protected readonly stopName = signal('');
  protected readonly justMarked = signal<number | null>(null);
  protected readonly confirmDiscard = signal(false);
  protected readonly confirmDelete = signal(false);

  protected readonly distance = computed(() => this.km(this.rec.distanceMetres()));
  protected readonly elapsed = computed(() => {
    const total = this.rec.elapsedSeconds();
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  });
  protected readonly problemKey = computed(() => {
    const problem = this.rec.problem();
    return problem ? PROBLEMS[problem] : null;
  });
  protected readonly issues = computed(() => this.rec.issues().map((issue) => ISSUES[issue]));
  protected readonly line = computed(() => this.rec.simplified().points);
  protected readonly stopPoints = computed(() => this.rec.stops().map((s) => s.at));
  protected readonly markers = computed<MapMarker[]>(() => {
    const points = this.line();
    const first = points[0];
    const last = points[points.length - 1];
    return first && last && points.length > 1
      ? [
          { kind: 'from', at: first },
          { kind: 'to', at: last },
        ]
      : [];
  });
  protected readonly deleteAfter = computed(() => {
    const uploaded = this.rec.uploaded();
    return uploaded ? formatDate(uploaded.delete_after, this.i18n.lang()) : null;
  });
  protected readonly canSubmit = computed(
    () => this.rec.view() === 'review' && this.issues().length === 0 && !this.countdown.active(),
  );

  constructor() {
    void this.rec.init();
    void this.cities.init();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected start(): void {
    const city = this.cities.selectedSlug();
    if (city) void this.rec.start(city);
  }

  protected async mark(): Promise<void> {
    if (await this.rec.markStop(null)) {
      this.justMarked.set(this.rec.stops().length - 1);
      this.stopName.set('');
    }
  }

  protected async nameMarked(event: Event): Promise<void> {
    event.preventDefault();
    const index = this.justMarked();
    if (index === null) return;
    await this.rec.renameStop(index, this.stopName());
    this.justMarked.set(null);
    this.stopName.set('');
  }

  protected rename(index: number, event: Event): void {
    void this.rec.renameStop(index, this.value(event));
  }

  protected async submit(): Promise<void> {
    const result = await this.rec.submit();
    if (!result.ok && result.retryAfter !== undefined && result.retryAfter !== null) {
      this.countdown.start(result.retryAfter);
    } else if (!result.ok && this.rec.submitError() === 'recorder.errors.rateLimited') {
      this.countdown.start(null);
    }
  }

  protected async discard(): Promise<void> {
    if (!this.confirmDiscard()) {
      this.confirmDiscard.set(true);
      return;
    }
    this.confirmDiscard.set(false);
    this.justMarked.set(null);
    await this.rec.discard();
  }

  protected async deleteTrace(): Promise<void> {
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      return;
    }
    this.confirmDelete.set(false);
    await this.rec.deleteUploaded();
  }

  protected proposeLine(): void {
    const trace = this.rec.uploaded();
    const city = this.rec.uploadedCity();
    if (!trace || !city) return;
    void this.router.navigate(['/katki/oneri'], {
      queryParams: { tur: 'new_line', iz: trace.id, city },
    });
  }

  protected proposeStop(index: number): void {
    const city = this.rec.uploadedCity();
    if (!city) return;
    void this.router.navigate(['/katki/oneri'], {
      queryParams: { tur: 'new_stop', isaret: index, city },
    });
  }

  protected finished(): void {
    this.rec.reset();
    void this.router.navigateByUrl('/katki');
  }

  private km(metres: number): string {
    const locale = this.i18n.lang() === 'tr' ? 'tr-TR' : 'en-GB';
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(metres / 1000);
  }
}
