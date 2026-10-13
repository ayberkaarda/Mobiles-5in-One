import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { ContributionApi, Edit, isApiError, SessionStore } from '@inecekvar/data-access';
import { formatFareMinor } from '@inecekvar/domain';
import { NoticeComponent, StateComponent, StatusBadgeComponent, StatusTone } from '@inecekvar/ui';
import { LanguageService } from '../core/language.service';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { isProposalKind, KIND_LABELS } from '../proposals/proposal-form';
import { BackButtonComponent } from '../shared/back-button.component';
import { formatDate } from '../shared/format';

const STATES: Record<string, { tone: StatusTone; label: TranslationKey }> = {
  pending: { tone: 'pending', label: 'proposals.pending' },
  approved: { tone: 'approved', label: 'proposals.approved' },
  rejected: { tone: 'rejected', label: 'proposals.rejected' },
};

export interface ProposalRow {
  id: string;
  kind: TranslationKey;
  state: { tone: StatusTone; label: TranslationKey };
  /** A short description from the payload: code and name, a stop name or a fare. Text only. */
  subject: string | null;
  created: string | null;
  reason: string | null;
}

function text(value: unknown, max = 200): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
}

/** What a proposal is about, from the stored payload, without trusting its shape. */
export function subjectOf(edit: Edit): string | null {
  const payload = edit.payload ?? {};
  const code = text(payload['code']);
  const name = text(payload['name']);
  if (code && name) return `${code} · ${name}`;
  if (name) return name;
  const changes = payload['changes'];
  if (typeof changes === 'object' && changes !== null) {
    const c = changes as Record<string, unknown>;
    const changed = text(c['name']) ?? text(c['hours_text']) ?? text(c['hail_notes']);
    if (changed) return changed;
    if (typeof c['fare_minor'] === 'number' && Number.isInteger(c['fare_minor'])) {
      return formatFareMinor(c['fare_minor']);
    }
  }
  const fare = payload['fare_minor'];
  if (typeof fare === 'number' && Number.isInteger(fare) && fare >= 0) return formatFareMinor(fare);
  return text(payload['reason']);
}

/** `/katki/onerilerim`: the signed-in user's proposals with their review state. */
@Component({
  selector: 'iv-proposals-page',
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
    StateComponent,
    StatusBadgeComponent,
    TPipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <iv-back-button fallback="/katki" />
        </ion-buttons>
        <ion-title>{{ 'proposals.title' | t }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="iv-page">
        <p class="iv-kicker">{{ 'proposals.kicker' | t }}</p>
        <h1 class="iv-heading">{{ 'proposals.heading' | t }}</h1>
        @if (justSent()) {
          <iv-notice class="sent" [message]="'proposals.sent' | t" />
        }
        @if (edits.isLoading()) {
          <p class="iv-hint" role="status">{{ 'proposals.loading' | t }}</p>
        } @else if (edits.error()) {
          <iv-state
            kind="error"
            [heading]="'proposals.errorTitle' | t"
            [message]="errorKey() | t"
            [actionLabel]="'proposals.retry' | t"
            (action)="edits.reload()"
          />
        } @else if (rows().length === 0) {
          <iv-state [heading]="'proposals.emptyTitle' | t" [message]="'proposals.emptyBody' | t">
            <a class="iv-button" routerLink="/katki">{{ 'proposals.toContribute' | t }}</a>
          </iv-state>
        } @else {
          <ul class="list" role="list">
            @for (row of rows(); track row.id) {
              <li class="iv-panel" [attr.data-state]="row.state.tone">
                <div class="top">
                  <span class="kind">{{ row.kind | t }}</span>
                  <iv-status-badge [tone]="row.state.tone" [label]="row.state.label | t" />
                </div>
                @if (row.subject) {
                  <p class="subject">{{ row.subject }}</p>
                }
                @if (row.created) {
                  <p class="iv-hint">{{ 'proposals.created' | t: { date: row.created } }}</p>
                }
                @if (row.reason) {
                  <p class="reason">
                    <strong>{{ 'proposals.reason' | t }}</strong>
                    {{ row.reason }}
                  </p>
                }
              </li>
            }
          </ul>
        }
      </div>
    </ion-content>
  `,
  styleUrl: '../../../../../libs/ui/src/styles/forms.css',
  styles: `
    .sent {
      margin-top: var(--iv-space-3);
    }
    .list {
      display: grid;
      gap: var(--iv-space-3);
      margin: var(--iv-space-4) 0 0;
      padding: 0;
      list-style: none;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .kind {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--iv-ink-muted);
    }
    .subject {
      margin: 6px 0 2px;
      font-size: 16px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .reason {
      margin: 8px 0 0;
      padding: 8px 10px;
      border-left: 4px solid var(--iv-danger);
      border-radius: 6px;
      background: var(--iv-surface-sunk);
      font-size: 14px;
      line-height: 1.45;
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .reason strong {
      display: block;
    }
    [data-state='rejected'] {
      border-color: color-mix(in srgb, var(--iv-danger) 40%, var(--iv-line));
    }
  `,
})
export class ProposalsPage {
  private readonly api = inject(ContributionApi);
  private readonly session = inject(SessionStore);
  private readonly identity = computed(() => this.session.user()?.id ?? null);
  private readonly entry = signal(0);
  private readonly i18n = inject(LanguageService);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap, { initialValue: null });

  protected readonly justSent = computed(() => this.query()?.get('yeni') === '1');
  protected readonly edits = resource({
    params: () => {
      const ownerId = this.identity();
      return ownerId ? { ownerId, entry: this.entry() } : undefined;
    },
    loader: async ({ params, abortSignal }) => {
      const edits = await this.api.myEdits({ limit: 100 }, abortSignal);
      return {
        ownerId: params.ownerId,
        edits:
          !abortSignal.aborted &&
          params.ownerId === this.identity() &&
          params.entry === this.entry()
            ? edits
            : [],
      };
    },
  });

  protected readonly errorKey = computed<TranslationKey>(() => {
    const error = this.edits.error();
    return isApiError(error) && (error.kind === 'network' || error.kind === 'timeout')
      ? 'proposals.offline'
      : 'proposals.errorBody';
  });

  protected readonly rows = computed<ProposalRow[]>(() => {
    const lang = this.i18n.lang();
    const value = this.edits.hasValue() ? this.edits.value() : null;
    const edits = value && value.ownerId === this.identity() ? value.edits : [];
    return edits.map((edit) => ({
      id: edit.id,
      kind: isProposalKind(edit.kind) ? KIND_LABELS[edit.kind] : 'proposals.otherKind',
      state: STATES[edit.state] ?? { tone: 'neutral', label: 'proposals.unknownState' },
      subject: subjectOf(edit),
      created: formatDate(edit.created_at, lang),
      reason: edit.state === 'rejected' ? text(edit.reason, 1000) : null,
    }));
  });

  ionViewWillEnter(): void {
    this.entry.update((entry) => entry + 1);
  }
}
