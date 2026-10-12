import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AdminApi, type QueueEdit } from '../admin-api';
import { adminErrorMessage, type ErrorContext } from '../admin-errors';
import { AdminSession } from '../admin-session';
import { ConfirmService } from '../dialogs/confirm.service';
import { StepUpService } from '../step-up/step-up.service';

export const REASON_MAX = 1000;

export type QueueNotice = { tone: 'ok' | 'error'; text: string; editId?: string };

/**
 * The pending queue for the signed-in reviewer. Everything it holds belongs to one account:
 * a sign-out or account switch (session generation) empties it before anything else renders.
 */
@Injectable()
export class QueueStore {
  private readonly api = inject(AdminApi);
  private readonly session = inject(AdminSession);
  private readonly stepUp = inject(StepUpService);
  private readonly confirm = inject(ConfirmService);
  private loadToken = 0;

  readonly items = signal<QueueEdit[]>([]);
  readonly ownIds = signal<ReadonlySet<string>>(new Set());
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  /** Ids with a decision in flight; their buttons stay disabled. */
  readonly busy = signal<ReadonlySet<string>>(new Set());
  readonly notice = signal<QueueNotice | null>(null);
  readonly count = computed(() => this.items().length);

  constructor() {
    effect(() => {
      this.session.generation();
      untracked(() => this.reset());
    });
  }

  reset(): void {
    this.loadToken++;
    this.items.set([]);
    this.ownIds.set(new Set());
    this.loading.set(false);
    this.loaded.set(false);
    this.error.set(null);
    this.busy.set(new Set());
    this.notice.set(null);
  }

  isOwn(id: string): boolean {
    return this.ownIds().has(id);
  }

  async load(): Promise<void> {
    const token = ++this.loadToken;
    this.loading.set(true);
    this.error.set(null);
    try {
      const [items, mine] = await Promise.all([
        this.api.queue(),
        this.api.myEdits().catch(() => []),
      ]);
      if (token !== this.loadToken) return;
      this.items.set(items);
      this.ownIds.set(new Set(mine.map((edit) => edit.id)));
      this.loaded.set(true);
    } catch (error) {
      if (token === this.loadToken) this.error.set(adminErrorMessage(error));
    } finally {
      if (token === this.loadToken) this.loading.set(false);
    }
  }

  async approve(edit: QueueEdit): Promise<void> {
    if (this.isOwn(edit.id)) {
      this.notice.set({
        tone: 'error',
        editId: edit.id,
        text: 'Kendi önerini onaylayamazsın; başka bir moderatör karar vermeli.',
      });
      return;
    }
    if (edit.kind === 'retire') {
      const ok = await this.confirm.ask({
        title: 'Hat kaldırılsın mı?',
        body: 'Onaylarsan hat yayından kalkar ve "kaldırıldı" olarak görünür. Bu işlem doğrulama kodu ister ve denetim kaydına yazılır.',
        confirmLabel: 'Hattı kaldır',
      });
      if (!ok) return;
    }
    await this.decide(edit.id, 'approve', async () => {
      // Retirement needs a fresh step-up (ADR-0021); other approvals pass straight through.
      await this.stepUp.run(() => this.api.approve(edit.id));
      return edit.kind === 'retire'
        ? 'Hat kaldırıldı.'
        : 'Öneri onaylandı ve yeni sürüm yayımlandı.';
    });
  }

  async reject(edit: QueueEdit, reason: string): Promise<boolean> {
    const text = reason.trim();
    if (text.length === 0 || Array.from(text).length > REASON_MAX) {
      this.notice.set({
        tone: 'error',
        editId: edit.id,
        text: 'Ret gerekçesi 1 ile 1000 karakter arasında olmalı.',
      });
      return false;
    }
    return this.decide(edit.id, 'reject', async () => {
      await this.api.reject(edit.id, text);
      return 'Öneri reddedildi; gerekçe katkıcıya gösterilir.';
    });
  }

  private async decide(
    id: string,
    context: ErrorContext,
    action: () => Promise<string>,
  ): Promise<boolean> {
    if (this.busy().has(id)) return false;
    const token = this.loadToken;
    this.busy.update((set) => new Set(set).add(id));
    this.notice.set(null);
    try {
      const message = await action();
      if (token !== this.loadToken) return false;
      this.items.update((items) => items.filter((item) => item.id !== id));
      this.notice.set({ tone: 'ok', text: message });
      return true;
    } catch (error) {
      if (token === this.loadToken) {
        this.notice.set({ tone: 'error', editId: id, text: adminErrorMessage(error, context) });
      }
      return false;
    } finally {
      if (token === this.loadToken) {
        this.busy.update((set) => {
          const next = new Set(set);
          next.delete(id);
          return next;
        });
      }
    }
  }
}
