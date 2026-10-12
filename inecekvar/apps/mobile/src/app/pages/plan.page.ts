import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import {
  ItineraryCardComponent,
  ItineraryStep,
  ItineraryStepsComponent,
  ItinerarySummary,
  StateComponent,
} from '@inecekvar/ui';
import { CityPickerComponent } from '../city/city-picker.component';
import { CityStore } from '../city/city.store';
import { LanguageService } from '../core/language.service';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { MapComponent } from '../map/map.component';
import { MapMarker } from '../map/map-style';
import { steps, summarize } from '../planner/itinerary';
import { MAX_TRANSFER_CHOICES, MaxTransfers, PlanEnd, PlanFormError } from '../planner/plan-form';
import { PlannerStore } from '../planner/planner.store';

const FORM_ERRORS: Record<PlanFormError, TranslationKey> = {
  'no-city': 'planner.errorNoCity',
  'missing-from': 'planner.errorMissingFrom',
  'missing-to': 'planner.errorMissingTo',
  'from-outside-city': 'planner.errorFromOutside',
  'to-outside-city': 'planner.errorToOutside',
  'same-place': 'planner.errorSamePlace',
  'bad-transfers': 'planner.errorTransfers',
};

const TRANSFER_LABELS: Record<MaxTransfers, TranslationKey> = {
  0: 'planner.transfers0',
  1: 'planner.transfers1',
  2: 'planner.transfers2',
};

interface EndView {
  end: PlanEnd;
  label: TranslationKey;
  inputId: string;
}

/** `/planla`: the A to B planner (user story 3). */
@Component({
  selector: 'iv-plan-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    CityPickerComponent,
    ItineraryCardComponent,
    ItineraryStepsComponent,
    MapComponent,
    StateComponent,
    TPipe,
  ],
  providers: [PlannerStore],
  templateUrl: './plan.page.html',
  styleUrl: './plan.page.scss',
})
export class PlanPage {
  private readonly i18n = inject(LanguageService);
  private readonly picker = viewChild(CityPickerComponent);
  protected readonly cities = inject(CityStore);
  protected readonly planner = inject(PlannerStore);

  protected readonly ends: readonly EndView[] = [
    { end: 'from', label: 'plan.from', inputId: 'iv-plan-from' },
    { end: 'to', label: 'plan.to', inputId: 'iv-plan-to' },
  ];
  protected readonly transferChoices = MAX_TRANSFER_CHOICES.map((value) => ({
    value,
    label: TRANSFER_LABELS[value],
  }));

  protected readonly formError = computed(() => {
    const error = this.planner.formError();
    return error ? FORM_ERRORS[error] : null;
  });

  private readonly t = (key: TranslationKey, params?: Record<string, unknown>) =>
    this.i18n.t(key, params);

  protected readonly summaries = computed<ItinerarySummary[]>(() => {
    this.i18n.lang();
    return this.planner.itineraries().map((itinerary, i) => summarize(itinerary, i, this.t));
  });

  protected readonly steps = computed<ItineraryStep[]>(() => {
    this.i18n.lang();
    const itinerary = this.planner.selectedItinerary();
    return itinerary ? steps(itinerary, this.t) : [];
  });

  protected readonly markers = computed<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    const from = this.planner.from();
    const to = this.planner.to();
    if (from) out.push({ kind: 'from', at: [from.lng, from.lat] });
    if (to) out.push({ kind: 'to', at: [to.lng, to.lat] });
    return out;
  });

  /** Boarding and alighting stops of the selected itinerary, drawn as stop circles. */
  protected readonly rideStops = computed<number[][]>(() => {
    const seen = new Set<string>();
    const out: number[][] = [];
    for (const leg of this.planner.selectedItinerary()?.legs ?? []) {
      if (leg.kind !== 'ride') continue;
      for (const stop of [leg.board_stop, leg.alight_stop]) {
        if (seen.has(stop.slug)) continue;
        seen.add(stop.slug);
        out.push([...stop.location]);
      }
    }
    return out;
  });

  /** The end a map tap would fill right now, or `null` when tapping changes nothing. */
  protected readonly pickEnd = computed<PlanEnd | null>(() => {
    if (this.planner.view() === 'results') return this.planner.pickTarget();
    const target = this.planner.pickTarget();
    if (target) return target;
    if (!this.planner.from()) return 'from';
    if (!this.planner.to()) return 'to';
    return null;
  });

  constructor() {
    void this.cities.init();
  }

  protected text(end: PlanEnd): string {
    return end === 'from' ? this.planner.fromText() : this.planner.toText();
  }

  protected chosen(end: PlanEnd): boolean {
    return (end === 'from' ? this.planner.from() : this.planner.to()) !== null;
  }

  protected onInput(end: PlanEnd, event: Event): void {
    this.planner.setText(end, (event.target as HTMLInputElement).value);
  }

  protected togglePick(end: PlanEnd): void {
    this.planner.pickTarget.set(this.planner.pickTarget() === end ? null : end);
  }

  protected setTransfers(value: MaxTransfers): void {
    this.planner.setMaxTransfers(value);
  }

  protected openPicker(): void {
    this.picker()?.show();
  }
}
