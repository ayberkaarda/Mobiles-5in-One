import { inject, Injectable, signal } from '@angular/core';
import { isApiError, SessionStore } from '@inecekvar/data-access';
import { RecorderStore } from '../contribute/recorder.store';
import { FavoritesStore } from '../core/favorites.store';
import { TranslationKey } from '../i18n/translation';
import { PURCHASES_ADAPTER } from '../plus/purchases';
import { ConnectivityService } from '../shared/connectivity.service';

/** Where the web page for account deletion lives (built in phase 4). */
export const WEB_DELETION_URL = 'https://inecekvar.app/hesap-silme';
/** The licence page on the web (phase 4). */
export const WEB_LICENCE_URL = 'https://inecekvar.app/veri-lisansi';

export type DeletionFailure =
  'offline' | 'wrong-password' | 'reauth-required' | 'rate-limited' | 'error';

export type DeletionResult =
  | { ok: true; cleanupFailed: boolean }
  | { ok: false; failure: DeletionFailure; retryAfterSeconds: number | null };

export const DELETION_FAILURE_KEYS: Record<DeletionFailure, TranslationKey> = {
  offline: 'account.deleteOffline',
  'wrong-password': 'account.deleteWrongPassword',
  'reauth-required': 'account.deleteReauth',
  'rate-limited': 'account.deleteRateLimited',
  error: 'account.deleteError',
};

/**
 * In-app account deletion (spec 6.21, ADR-0026). The API re-authenticates (the password, or a
 * sign-in younger than ten minutes for an account without one), deactivates the account at
 * once, revokes every session, deletes favourites and private traces and withdraws pending
 * proposals; approved contributions stay under the licence as "silinmiş katkıcı". Only after
 * the API has accepted the request does this device forget the account: tokens (in the
 * strategy), the unsent ride draft, and what the favourites store recorded about the account.
 * Offline nothing is sent and nothing is removed, so a deletion is never half done locally.
 * Offline packs hold public city data and no account data, so they stay.
 */
@Injectable({ providedIn: 'root' })
export class AccountDeletion {
  private readonly session = inject(SessionStore);
  private readonly recorder = inject(RecorderStore);
  private readonly favorites = inject(FavoritesStore);
  private readonly connectivity = inject(ConnectivityService);
  private readonly purchases = inject(PURCHASES_ADAPTER);

  readonly busy = signal(false);

  async delete(password: string | null): Promise<DeletionResult> {
    if (this.busy()) return { ok: false, failure: 'error', retryAfterSeconds: null };
    if (!this.connectivity.online()) {
      return { ok: false, failure: 'offline', retryAfterSeconds: null };
    }
    const userId = this.session.user()?.id ?? null;
    this.busy.set(true);
    try {
      await this.session.deleteAccount(password === null || password === '' ? undefined : password);
    } catch (error) {
      this.busy.set(false);
      return { ok: false, failure: failureOf(error), retryAfterSeconds: retryOf(error) };
    }
    try {
      return { ok: true, cleanupFailed: !(await this.cleanLocal(userId)) };
    } finally {
      this.busy.set(false);
    }
  }

  /** True when every local trace of the account is gone. */
  private async cleanLocal(userId: string | null): Promise<boolean> {
    let clean = true;
    await this.recorder.discard();
    if (this.recorder.cleanupPending()) clean = false;
    if (userId !== null) {
      try {
        await this.favorites.forgetAccount(userId);
      } catch {
        clean = false;
      }
    }
    // The store SDK keeps the app user id it was given; a deleted account must not stay there.
    await this.purchases.forget().catch(() => undefined);
    return clean;
  }
}

function failureOf(error: unknown): DeletionFailure {
  if (!isApiError(error)) return 'error';
  if (error.kind === 'network' || error.kind === 'timeout') return 'offline';
  if (error.status === 429) return 'rate-limited';
  if (error.code === 'auth.invalid_credentials') return 'wrong-password';
  if (error.code === 'auth.reauth_required') return 'reauth-required';
  return 'error';
}

function retryOf(error: unknown): number | null {
  return isApiError(error) ? error.retryAfterSeconds : null;
}
