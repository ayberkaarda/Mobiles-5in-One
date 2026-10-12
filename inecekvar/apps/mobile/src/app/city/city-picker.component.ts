import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { IonContent, IonModal } from '@ionic/angular';
import { TPipe, TpPipe } from '../i18n/i18n';
import { CityStore } from './city.store';

/**
 * The current city as a chip-like button; tapping it opens a bottom sheet with every city.
 * Choosing one stores it through `CityStore` and closes the sheet.
 */
@Component({
  selector: 'iv-city-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonModal, IonContent, TPipe, TpPipe],
  template: `
    <button type="button" class="trigger" aria-haspopup="dialog" (click)="open.set(true)">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21z" />
        <circle cx="12" cy="9.5" r="2.5" />
      </svg>
      <span class="trigger-label">{{ 'city.label' | t }}</span>
      <span class="trigger-name">{{ store.selected()?.name ?? ('city.choose' | t) }}</span>
      <svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>

    <ion-modal
      [isOpen]="open()"
      aria-labelledby="iv-city-title"
      [breakpoints]="[0, 0.6, 1]"
      [initialBreakpoint]="0.6"
      (didDismiss)="open.set(false)"
    >
      <ng-template>
        <ion-content>
          <div class="sheet">
            <h2 id="iv-city-title" class="title">{{ 'city.pickerTitle' | t }}</h2>
            <p class="lead">{{ 'city.pickerLead' | t }}</p>
            @if (store.status() === 'error') {
              <p class="error" role="alert">{{ 'city.loadError' | t }}</p>
              <button type="button" class="iv-button" (click)="store.load()">
                {{ 'search.retry' | t }}
              </button>
            }
            <ul class="cities" role="radiogroup" [attr.aria-label]="'city.label' | t">
              @for (city of store.cities(); track city.slug) {
                <li>
                  <button
                    type="button"
                    role="radio"
                    class="city"
                    [class.on]="city.slug === store.selectedSlug()"
                    [attr.aria-checked]="city.slug === store.selectedSlug()"
                    [attr.data-slug]="city.slug"
                    (click)="choose(city.slug)"
                  >
                    <span class="city-name">{{ city.name }}</span>
                    <span class="city-meta">
                      {{ 'city.lineCount' | tp: city.published_line_count }}
                      @if (city.is_sample) {
                        <span class="sample">{{ 'city.sample' | t }}</span>
                      }
                    </span>
                  </button>
                </li>
              }
            </ul>
            <button type="button" class="close" (click)="open.set(false)">
              {{ 'city.close' | t }}
            </button>
          </div>
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
  styleUrl: './city-picker.component.scss',
})
export class CityPickerComponent {
  protected readonly store = inject(CityStore);
  protected readonly open = signal(false);

  /** Opens the sheet, for example from a "pick your city" prompt elsewhere on the page. */
  show(): void {
    this.open.set(true);
  }

  protected async choose(slug: string): Promise<void> {
    await this.store.select(slug);
    this.open.set(false);
  }
}
