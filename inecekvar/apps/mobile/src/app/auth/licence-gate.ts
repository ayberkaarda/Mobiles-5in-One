import { inject, Injectable, Injector, signal } from '@angular/core';
import { isApiError, SessionStore } from '@inecekvar/data-access';
import { TranslationKey } from '../i18n/translation';

/**
 * The open-data licence must be accepted before the first contribution (user story 9,
 * ADR-0003). `ensure()` resolves at once when it already is; otherwise it opens the licence
 * dialog and resolves with the user's choice. The API enforces the same rule (403 without it).
 */
@Injectable({ providedIn: 'root' })
export class LicenceGate {
  // Resolved on first use: the dialog host in the tab shell must not start the API client.
  private readonly injector = inject(Injector);
  private waiters: ((accepted: boolean) => void)[] = [];

  readonly open = signal(false);
  readonly busy = signal(false);
  readonly error = signal<TranslationKey | null>(null);

  private get session(): SessionStore {
    return this.injector.get(SessionStore);
  }

  ensure(): Promise<boolean> {
    if (this.session.licenceAccepted()) return Promise.resolve(true);
    this.error.set(null);
    this.open.set(true);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * After a 403 on a submission: re-reads the account (the licence may have been accepted on
   * another device, or the cached user is stale) and asks again when it still is not accepted.
   */
  async recheck(): Promise<boolean> {
    try {
      await this.session.reload();
    } catch {
      return false;
    }
    return this.ensure();
  }

  async accept(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.session.acceptLicence();
      this.finish(true);
    } catch (error) {
      this.error.set(
        isApiError(error) && (error.kind === 'network' || error.kind === 'timeout')
          ? 'licence.offline'
          : 'licence.failed',
      );
    } finally {
      this.busy.set(false);
    }
  }

  decline(): void {
    this.finish(false);
  }

  private finish(accepted: boolean): void {
    this.open.set(false);
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(accepted);
  }
}
