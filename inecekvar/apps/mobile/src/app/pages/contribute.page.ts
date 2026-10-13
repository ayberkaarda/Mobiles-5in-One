import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { SessionStore } from '@inecekvar/data-access';
import { NoticeComponent } from '@inecekvar/ui';
import { RecorderStore } from '../contribute/recorder.store';
import { TPipe, TpPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';

interface ContributionAction {
  id: string;
  title: TranslationKey;
  body: TranslationKey;
  /** SVG path data for a 24-unit stroke icon. */
  icon: string;
  link: string;
  query: Record<string, string>;
}

const ACTIONS: readonly ContributionAction[] = [
  {
    id: 'trace',
    title: 'contribute.traceTitle',
    body: 'contribute.traceBody',
    icon: 'M5 19c3-1 3-6 7-7s4-6 7-7M5 19a2 2 0 100-.01M19 5a2 2 0 100-.01',
    link: '/katki/kayit',
    query: {},
  },
  {
    id: 'new-line',
    title: 'contribute.newLineTitle',
    body: 'contribute.newLineBody',
    icon: 'M12 5v14M5 12h14',
    link: '/katki/oneri',
    query: { tur: 'new_line' },
  },
  {
    id: 'fare',
    title: 'contribute.fareTitle',
    body: 'contribute.fareBody',
    icon: 'M9 4v16c4.5 0 8-3 8-7.5M5 11.5l9-3M5 15.5l9-3',
    link: '/katki/oneri',
    query: { tur: 'fare_update' },
  },
  {
    id: 'stop',
    title: 'contribute.stopTitle',
    body: 'contribute.stopBody',
    icon: 'M12 21v-9m0 0a4 4 0 100-8 4 4 0 000 8z',
    link: '/katki/oneri',
    query: { tur: 'new_stop' },
  },
];

const LINE_ACTIONS: readonly { kind: string; label: TranslationKey }[] = [
  { kind: 'update_line', label: 'contribute.lineUpdate' },
  { kind: 'fare_update', label: 'contribute.lineFare' },
  { kind: 'retire', label: 'contribute.lineRetire' },
];

/** `/katki`: the contributor hub. Tools need an account; guests see what is possible. */
@Component({
  selector: 'iv-contribute-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    RouterLink,
    NoticeComponent,
    TPipe,
    TpPipe,
  ],
  templateUrl: './contribute.page.html',
  styleUrls: ['../../../../../libs/ui/src/styles/forms.css', './contribute.page.scss'],
})
export class ContributePage {
  protected readonly session = inject(SessionStore);
  protected readonly recorder = inject(RecorderStore);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap, { initialValue: null });

  protected readonly actions = ACTIONS;
  protected readonly lineActions = LINE_ACTIONS;
  /** Opened from a line page ("Bu hat değişti"): offer the proposals about that line. */
  protected readonly line = computed(() => {
    const query = this.query();
    const slug = query?.get('hat');
    const city = query?.get('city');
    return slug && city ? { slug, city } : null;
  });
  protected readonly name = computed(() => {
    const user = this.session.user();
    return user ? (user.display_name ?? user.email) : null;
  });
  protected readonly hasDraft = computed(() => {
    const view = this.recorder.view();
    return view === 'paused' || view === 'review' || view === 'recording';
  });
  protected readonly signinParams = { sonra: '/katki' };

  constructor() {
    void this.recorder.init();
  }

  protected lineQuery(kind: string): Record<string, string> {
    const line = this.line();
    return line ? { tur: kind, hat: line.slug, city: line.city } : { tur: kind };
  }
}
