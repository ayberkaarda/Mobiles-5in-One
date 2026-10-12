import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';

interface ContributionAction {
  id: string;
  title: TranslationKey;
  body: TranslationKey;
  /** SVG path data for a 24-unit stroke icon. */
  icon: string;
}

const ACTIONS: readonly ContributionAction[] = [
  {
    id: 'trace',
    title: 'contribute.traceTitle',
    body: 'contribute.traceBody',
    icon: 'M5 19c3-1 3-6 7-7s4-6 7-7M5 19a2 2 0 100-.01M19 5a2 2 0 100-.01',
  },
  {
    id: 'new-line',
    title: 'contribute.newLineTitle',
    body: 'contribute.newLineBody',
    icon: 'M12 5v14M5 12h14',
  },
  {
    id: 'fare',
    title: 'contribute.fareTitle',
    body: 'contribute.fareBody',
    icon: 'M9 4v16c4.5 0 8-3 8-7.5M5 11.5l9-3M5 15.5l9-3',
  },
  {
    id: 'stop',
    title: 'contribute.stopTitle',
    body: 'contribute.stopBody',
    icon: 'M12 21v-9m0 0a4 4 0 100-8 4 4 0 000 8z',
  },
];

@Component({
  selector: 'iv-contribute-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, TPipe],
  templateUrl: './contribute.page.html',
  styleUrl: './contribute.page.scss',
})
export class ContributePage {
  protected readonly actions = ACTIONS;
}
