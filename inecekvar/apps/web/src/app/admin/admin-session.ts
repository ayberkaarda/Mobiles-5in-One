import { computed, inject, Injectable, signal } from '@angular/core';
import { SessionStore } from '@inecekvar/data-access';
import { AdminApi, type Role, type TotpStatus } from './admin-api';

/** Roles that may open the admin area at all; the API still decides every action. */
export const STAFF_ROLES: readonly Role[] = ['moderator', 'admin'];

export type SignInNotice = 'expired' | 'signed-out' | 'not-staff' | null;

/**
 * The admin view of the shared session store: start-up once, staff checks for the UI, and a
 * generation number that changes whenever the signed-in account changes or signs out, so
 * page stores drop what they loaded for the previous account.
 */
@Injectable()
export class AdminSession {
  private readonly store = inject(SessionStore);
  private started: Promise<void> | null = null;
  private lastUserId: string | null = null;
  private checking: Promise<boolean> | null = null;
  private readonly generationSignal = signal(0);
  private readonly noticeSignal = signal<SignInNotice>(null);
  private readonly api = inject(AdminApi);
  private readonly totpSignal = signal<TotpStatus | null>(null);
  /** TOTP status of the signed-in account, or null while unknown. */
  readonly totp = this.totpSignal.asReadonly();

  readonly user = this.store.user;
  readonly status = this.store.status;
  readonly role = this.store.role;
  readonly isStaff = computed(() => {
    const role = this.role();
    return role !== null && STAFF_ROLES.includes(role);
  });
  readonly isAdmin = computed(() => this.role() === 'admin');
  /** Changes on every account switch or sign-out. */
  readonly generation = this.generationSignal.asReadonly();
  /** Why the sign-in page is shown, set by sign-out and session expiry. */
  readonly notice = this.noticeSignal.asReadonly();

  /** Resolves once the stored session has been checked with `GET /me`. */
  ready(): Promise<void> {
    this.started ??= this.store.init().then(() => this.track());
    return this.started;
  }

  /** Called by the shell whenever the user signal changes. */
  track(): void {
    const id = this.store.user()?.id ?? null;
    if (id !== this.lastUserId) {
      const wasSignedIn = this.lastUserId !== null;
      this.lastUserId = id;
      this.totpSignal.set(null);
      this.generationSignal.update((value) => value + 1);
      if (id === null && wasSignedIn && this.noticeSignal() === null) {
        this.noticeSignal.set('expired');
      }
    }
  }

  /**
   * Re-reads `GET me`, because another tab of the same browser may have signed out or signed in
   * as someone else on the shared cookie. Concurrent calls share one request. Resolves false when
   * the account changed; `track()` then moves the generation, which closes dialogs, cancels a
   * pending step-up and resets the page stores. A network failure keeps the current state.
   */
  recheck(): Promise<boolean> {
    this.checking ??= this.runRecheck().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async runRecheck(): Promise<boolean> {
    const before = this.lastUserId;
    if (this.store.status() === 'signed-in') {
      try {
        await this.store.reload();
      } catch {
        // A 401 has already ended the session through the auth strategy; other failures keep it.
      }
    }
    this.track();
    return this.lastUserId === before;
  }

  /** Reads `GET me/totp` for the current account; a failure leaves the status unknown. */
  async refreshTotp(): Promise<void> {
    const generation = this.generationSignal();
    try {
      const status = await this.api.totpStatus();
      if (generation === this.generationSignal()) this.totpSignal.set(status);
    } catch {
      if (generation === this.generationSignal()) this.totpSignal.set(null);
    }
  }

  setTotp(status: TotpStatus): void {
    this.totpSignal.set(status);
  }

  async signIn(email: string, password: string): Promise<'staff' | 'not-staff'> {
    const user = await this.store.login(email, password);
    this.track();
    if (!STAFF_ROLES.includes(user.role)) {
      await this.signOut('not-staff');
      return 'not-staff';
    }
    this.noticeSignal.set(null);
    return 'staff';
  }

  async signOut(notice: SignInNotice = 'signed-out'): Promise<void> {
    this.noticeSignal.set(notice);
    try {
      await this.store.logout();
    } finally {
      this.track();
    }
  }

  clearNotice(): void {
    this.noticeSignal.set(null);
  }
}
