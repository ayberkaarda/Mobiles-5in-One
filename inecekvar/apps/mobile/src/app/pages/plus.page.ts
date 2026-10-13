import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { NoticeComponent } from '@inecekvar/ui';
import { CityStore } from '../city/city.store';
import { LanguageService } from '../core/language.service';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { PlusOffer } from '../plus/purchases';
import { PlusState, PlusStore } from '../plus/plus.store';
import { BackButtonComponent } from '../shared/back-button.component';
import { formatMoney } from '../shared/format';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const OUTCOME_KEYS: Partial<Record<PlusState, TranslationKey>> = {
  purchased: 'plus.purchased',
  cancelled: 'plus.cancelled',
  restored: 'plus.restored',
  error: 'plus.error',
};

const PERIOD_KEYS: Record<PlusOffer['period'], TranslationKey> = {
  month: 'plus.perMonth',
  year: 'plus.perYear',
  other: 'plus.perOther',
};

/**
 * `/plus`: the paywall (user story 8). Native only: the web and the PWA stay free and say so.
 * Opened from the packs page after a `403 pack.entitlement_required` with `?sehir=`. The page
 * never unlocks a pack itself; the API decides every download.
 */
@Component({
  selector: 'iv-plus-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonTitle,
    IonContent,
    RouterLink,
    BackButtonComponent,
    NoticeComponent,
    TPipe,
  ],
  templateUrl: './plus.page.html',
  styleUrls: ['../../../../../libs/ui/src/styles/forms.css', './plus.page.scss'],
})
export class PlusPage {
  protected readonly plus = inject(PlusStore);
  private readonly i18n = inject(LanguageService);
  private readonly cities = inject(CityStore);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  /** The city whose download was refused, when the link names a known one. */
  protected readonly cityName = computed(() => {
    const slug = this.query()?.get('sehir') ?? '';
    if (!SLUG.test(slug) || slug.length > 120) return null;
    return this.cities.cities().find((c) => c.slug === slug)?.name ?? null;
  });

  protected readonly outcome = computed(() => OUTCOME_KEYS[this.plus.state()] ?? null);

  constructor() {
    void this.cities.init();
    void this.plus.load();
  }

  ionViewWillEnter(): void {
    void this.plus.load();
  }

  protected price(offer: PlusOffer): string {
    return this.i18n.t(PERIOD_KEYS[offer.period], {
      price: formatMoney(offer.price, offer.currency, this.i18n.lang()),
    });
  }

  protected buy(offer: PlusOffer): void {
    void this.plus.buy(offer.id);
  }

  protected restore(): void {
    void this.plus.restore();
  }

  protected retry(): void {
    void this.plus.load();
  }
}
