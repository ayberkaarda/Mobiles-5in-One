import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { AdminApi, type AuditLogPage, type AuditQuery, PAGE_SIZE } from '../admin-api';
import { adminErrorMessage } from '../admin-errors';
import { AUDIT_ACTION_LABELS, formatTime } from '../admin-text';
import { StepUpService } from '../step-up/step-up.service';

export const MAX_AUDIT_DAYS = 366;
const DAY_MS = 86_400_000;
const NAME = /^[a-z_.]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AuditFilters {
  action: string;
  targetType: string;
  actorId: string;
  targetId: string;
  /** `YYYY-MM-DD` from a date input, Istanbul time (UTC+3 all year). */
  since: string;
  until: string;
}

export const EMPTY_FILTERS: AuditFilters = {
  action: '',
  targetType: '',
  actorId: '',
  targetId: '',
  since: '',
  until: '',
};

/**
 * Validates the filters the same way the API does (names `^[a-z_.]{1,64}$`, UUIDs, a window of
 * at most 366 days) and fills a default window of the last 30 days.
 */
export function buildAuditQuery(
  filters: AuditFilters,
  offset: number,
  now: Date,
): { query: AuditQuery } | { error: string } {
  const action = filters.action.trim();
  const targetType = filters.targetType.trim();
  const actorId = filters.actorId.trim();
  const targetId = filters.targetId.trim();
  if (action && !NAME.test(action))
    return {
      error: 'İşlem adı küçük harf, nokta ve alt çizgiden oluşur (ör. moderation.rollback).',
    };
  if (targetType && !NAME.test(targetType))
    return { error: 'Hedef türü küçük harf, nokta ve alt çizgiden oluşur (ör. line).' };
  if (actorId && !UUID.test(actorId))
    return { error: 'İşlemi yapan kimliği geçerli bir UUID olmalı.' };
  if (targetId && !UUID.test(targetId)) return { error: 'Hedef kimliği geçerli bir UUID olmalı.' };
  if (
    (filters.since && !DATE.test(filters.since)) ||
    (filters.until && !DATE.test(filters.until))
  ) {
    return { error: 'Tarihleri GG.AA.YYYY biçiminde seç.' };
  }
  const until = filters.until ? new Date(`${filters.until}T23:59:59.999+03:00`) : now;
  const since = filters.since
    ? new Date(`${filters.since}T00:00:00+03:00`)
    : new Date(until.getTime() - 30 * DAY_MS);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    return { error: 'Tarihleri GG.AA.YYYY biçiminde seç.' };
  }
  if (since.getTime() > until.getTime())
    return { error: 'Başlangıç tarihi bitişten sonra olamaz.' };
  if (until.getTime() - since.getTime() > MAX_AUDIT_DAYS * DAY_MS) {
    return { error: `Tarih aralığı en fazla ${MAX_AUDIT_DAYS} gün olabilir.` };
  }
  return {
    query: {
      limit: PAGE_SIZE,
      offset: Math.max(0, offset),
      ...(action ? { action } : {}),
      ...(targetType ? { target_type: targetType } : {}),
      ...(actorId ? { actor_id: actorId.toLowerCase() } : {}),
      ...(targetId ? { target_id: targetId.toLowerCase() } : {}),
      since: since.toISOString(),
      until: until.toISOString(),
    },
  };
}

/** Audit log (admin only, step-up): actor, action, target and diff hash, never user values. */
@Component({
  selector: 'iv-admin-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Denetim kaydı</h1>
    <form
      class="iv-admin-card grid"
      (submit)="
        $event.preventDefault();
        search({
          action: action.value,
          targetType: target.value,
          actorId: actor.value,
          targetId: targetId.value,
          since: since.value,
          until: until.value,
        })
      "
    >
      <div>
        <label for="iv-audit-action">İşlem</label>
        <input
          id="iv-audit-action"
          #action
          list="iv-audit-actions"
          maxlength="64"
          placeholder="moderation.rollback"
        />
        <datalist id="iv-audit-actions">
          @for (name of actionNames; track name) {
            <option [value]="name">{{ actionLabel(name) }}</option>
          }
        </datalist>
      </div>
      <div>
        <label for="iv-audit-target">Hedef türü</label>
        <input id="iv-audit-target" #target maxlength="64" placeholder="line" />
      </div>
      <div>
        <label for="iv-audit-actor">İşlemi yapan (UUID)</label>
        <input id="iv-audit-actor" #actor maxlength="36" />
      </div>
      <div>
        <label for="iv-audit-target-id">Hedef (UUID)</label>
        <input id="iv-audit-target-id" #targetId maxlength="36" />
      </div>
      <div>
        <label for="iv-audit-since">Başlangıç</label>
        <input id="iv-audit-since" #since type="date" />
      </div>
      <div>
        <label for="iv-audit-until">Bitiş</label>
        <input id="iv-audit-until" #until type="date" />
      </div>
      <div class="iv-admin-actions">
        <button type="submit" [disabled]="busy()">{{ busy() ? 'Yükleniyor…' : 'Filtrele' }}</button>
      </div>
    </form>
    <p class="iv-admin-muted">
      Boş tarihler son 30 günü getirir; aralık en fazla 366 gün olabilir.
    </p>
    @if (error(); as text) {
      <p class="iv-admin-error" role="alert">{{ text }}</p>
    }
    @if (page(); as current) {
      <p class="iv-admin-muted" data-audit="total">{{ current.total }} kayıt</p>
      <div class="scroll iv-admin-card">
        <table class="stack">
          <thead>
            <tr>
              <th scope="col">Zaman</th>
              <th scope="col">İşlem</th>
              <th scope="col">Hedef</th>
              <th scope="col">Yapan</th>
              <th scope="col">Fark özeti</th>
            </tr>
          </thead>
          <tbody>
            @for (row of current.items; track row.id) {
              <tr [attr.data-action]="row.action">
                <td data-label="Zaman">{{ time(row.created_at) }}</td>
                <td data-label="İşlem">
                  <div>
                    {{ actionLabel(row.action) }}<br /><code>{{ row.action }}</code>
                  </div>
                </td>
                <td data-label="Hedef">
                  <div>
                    {{ row.target_type }}<br /><code>{{ row.target_id ?? '—' }}</code>
                  </div>
                </td>
                <td data-label="Yapan">
                  <code>{{ row.actor_id ?? '—' }}</code>
                </td>
                <td data-label="Fark özeti">
                  <code>{{ row.diff_hash ? row.diff_hash.slice(0, 12) + '…' : '—' }}</code>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5">Bu filtrelerle kayıt yok.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="iv-admin-actions">
        <button
          type="button"
          class="secondary"
          [disabled]="busy() || current.offset === 0"
          (click)="go(current.offset - pageSize)"
        >
          Önceki
        </button>
        <button
          type="button"
          class="secondary"
          [disabled]="busy() || current.offset + current.items.length >= current.total"
          (click)="go(current.offset + pageSize)"
        >
          Sonraki
        </button>
      </div>
    }
  `,
  styles: `
    code {
      font-size: 0.8125rem;
      overflow-wrap: anywhere;
    }
  `,
})
export class AuditPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly stepUp = inject(StepUpService);
  protected readonly actionNames = Object.keys(AUDIT_ACTION_LABELS);
  protected readonly pageSize = PAGE_SIZE;
  protected readonly page = signal<AuditLogPage | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private filters: AuditFilters = EMPTY_FILTERS;

  ngOnInit(): Promise<void> {
    return this.go(0);
  }

  protected actionLabel(action: string): string {
    return AUDIT_ACTION_LABELS[action] ?? action;
  }

  protected time(iso: string): string {
    return formatTime(iso);
  }

  search(filters: AuditFilters): Promise<void> {
    this.filters = filters;
    return this.go(0);
  }

  async go(offset: number): Promise<void> {
    if (this.busy()) return;
    const built = buildAuditQuery(this.filters, offset, new Date());
    if ('error' in built) {
      this.error.set(built.error);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      this.page.set(await this.stepUp.run(() => this.api.auditLogs(built.query)));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
