import { computed, inject, Injectable, signal } from '@angular/core';
import { isApiError } from './api-error';
import type { Me, StatusResponse, UserRole } from './api-types';
import { AuthApi } from './auth/auth-api';
import { AUTH_STRATEGY } from './auth/auth-strategy';
import { fragmentOf, readMagicLinkFragment } from './auth/magic-link';
import { PENDING_LOGOUT_MARKER } from './auth/pending-logout-marker';
import { AccountApi } from './endpoints';

export type SessionState =
  /** Not decided yet: start-up still running, or the API was unreachable while restoring. */
  | { readonly status: 'unknown' }
  | { readonly status: 'anonymous' }
  | { readonly status: 'signed-in'; readonly user: Me };

type HistoryLike = Pick<History, 'replaceState' | 'state'>;
type LocationLike = Pick<Location, 'hash' | 'pathname' | 'search'>;

/**
 * Who is using the app, as signals. Roles shown here drive the UI only; every permission is
 * enforced by the API (spec section 6.4).
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly auth = inject(AuthApi);
  private readonly account = inject(AccountApi);
  private readonly strategy = inject(AUTH_STRATEGY);
  private readonly marker = inject(PENDING_LOGOUT_MARKER);
  private epoch = 0;

  private readonly state = signal<SessionState>({ status: 'unknown' });
  private magicLinkToken: string | null = null;
  private readonly magicLinkPending = signal(false);
  private readonly pendingLogout = signal(this.marker.isSet());

  readonly session = this.state.asReadonly();
  readonly status = computed(() => this.state().status);
  readonly user = computed(() => {
    const state = this.state();
    return state.status === 'signed-in' ? state.user : null;
  });
  readonly isSignedIn = computed(() => this.user() !== null);
  readonly role = computed<UserRole | null>(() => this.user()?.role ?? null);
  readonly licenceAccepted = computed(() => this.user()?.licence_accepted ?? false);
  /** A magic-link token was captured and waits for `completeMagicLink`. */
  readonly hasPendingMagicLink = this.magicLinkPending.asReadonly();
  readonly logoutPending = this.pendingLogout.asReadonly();

  constructor() {
    this.strategy.onSessionEnded(() => {
      this.epoch += 1;
      this.state.set({ status: 'anonymous' });
      this.pendingLogout.set(this.marker.isSet());
    });
  }

  /**
   * Start-up: capture a magic-link fragment first (synchronously, before any await, so the
   * token leaves the address bar before the router or anything else reads it), then ask the API
   * whether a stored session is still valid. Never rejects.
   */
  async init(
    location: LocationLike = globalThis.location,
    history: HistoryLike = globalThis.history,
  ): Promise<void> {
    this.consumeMagicLinkFragment(location, history);
    const epoch = this.epoch;
    try {
      if (this.marker.isSet()) {
        this.state.set({ status: 'anonymous' });
        await this.retryPendingLogout();
        return;
      }
      if (!(await this.strategy.restore())) {
        if (epoch === this.epoch) this.state.set({ status: 'anonymous' });
        return;
      }
      if (epoch !== this.epoch) return;
      const user = await this.account.me();
      if (epoch === this.epoch) this.state.set({ status: 'signed-in', user });
    } catch (error) {
      if (epoch === this.epoch && isApiError(error) && error.status === 401) {
        this.state.set({ status: 'anonymous' });
      }
      // Offline or server trouble: keep `unknown` and any stored credential for a later retry.
    }
  }

  /** Takes `#token=` out of the current URL; true when a usable token was captured. */
  consumeMagicLinkFragment(location: LocationLike, history: HistoryLike): boolean {
    const { present, token } = readMagicLinkFragment(location.hash);
    if (!present) return false;
    history.replaceState(history.state, '', location.pathname + location.search);
    return this.capture(token);
  }

  /** Native deep links (`appUrlOpen`) arrive as a URL string instead of the page location. */
  consumeMagicLinkUrl(url: string): boolean {
    const { present, token } = readMagicLinkFragment(fragmentOf(url));
    return present && this.capture(token);
  }

  /**
   * Verifies the captured link. A registration link also needs the password chosen at
   * registration: without it the API answers 401 `auth.invalid_credentials` and the token stays
   * pending so the UI can ask for the password and call again.
   */
  async completeMagicLink(password?: string): Promise<Me> {
    const token = this.magicLinkToken;
    if (token === null) throw new Error('no magic link is pending');
    const epoch = ++this.epoch;
    try {
      const user = await this.auth.verifyMagicLink(token, password);
      if (epoch === this.epoch) {
        this.dropMagicLink();
        this.state.set({ status: 'signed-in', user });
        this.pendingLogout.set(this.marker.isSet());
      }
      return user;
    } catch (error) {
      const askPassword =
        password === undefined && isApiError(error) && error.code === 'auth.invalid_credentials';
      if (epoch === this.epoch && !askPassword) this.dropMagicLink();
      throw error;
    }
  }

  async login(email: string, password: string): Promise<Me> {
    const epoch = ++this.epoch;
    const user = await this.auth.login(email, password);
    if (epoch === this.epoch) {
      this.state.set({ status: 'signed-in', user });
      this.pendingLogout.set(this.marker.isSet());
    }
    return user;
  }

  register(email: string, password: string, displayName?: string): Promise<StatusResponse> {
    return this.auth.register(email, password, displayName);
  }

  requestMagicLink(email: string): Promise<StatusResponse> {
    return this.auth.requestMagicLink(email);
  }

  /** Re-reads the user (role and licence can change on the server). */
  async reload(): Promise<Me> {
    const epoch = this.epoch;
    const user = await this.account.me();
    if (epoch === this.epoch) this.state.set({ status: 'signed-in', user });
    return user;
  }

  async acceptLicence(): Promise<Me> {
    const epoch = this.epoch;
    const user = await this.account.acceptLicence();
    if (epoch === this.epoch) this.state.set({ status: 'signed-in', user });
    return user;
  }

  async logout(): Promise<void> {
    this.beginLogout();
    const epoch = this.epoch;
    try {
      await this.auth.logout();
    } finally {
      if (epoch === this.epoch) this.pendingLogout.set(this.marker.isSet());
    }
  }

  async logoutEverywhere(): Promise<void> {
    this.beginLogout();
    const epoch = this.epoch;
    try {
      await this.auth.logoutEverywhere();
    } finally {
      if (epoch === this.epoch) this.pendingLogout.set(this.marker.isSet());
    }
  }

  async deleteAccount(password?: string): Promise<StatusResponse> {
    const epoch = ++this.epoch;
    const result = await this.account.deleteAccount(password);
    if (epoch === this.epoch) {
      this.dropMagicLink();
      this.state.set({ status: 'anonymous' });
      this.pendingLogout.set(this.marker.isSet());
    }
    return result;
  }

  async retryPendingLogout(): Promise<boolean> {
    const epoch = this.epoch;
    if (this.marker.isSet()) {
      this.state.set({ status: 'anonymous' });
      this.pendingLogout.set(true);
    }
    const done = await this.auth.completePendingLogout();
    if (epoch === this.epoch) this.pendingLogout.set(this.marker.isSet());
    return done;
  }

  private beginLogout(): void {
    this.epoch += 1;
    this.dropMagicLink();
    this.state.set({ status: 'anonymous' });
    this.pendingLogout.set(true);
  }

  private capture(token: string | null): boolean {
    this.magicLinkToken = token;
    this.magicLinkPending.set(token !== null);
    return token !== null;
  }

  private dropMagicLink(): void {
    this.magicLinkToken = null;
    this.magicLinkPending.set(false);
  }
}
