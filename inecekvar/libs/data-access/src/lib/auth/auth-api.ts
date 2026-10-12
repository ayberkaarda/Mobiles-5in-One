import { inject, Injectable } from '@angular/core';
import { ApiClient } from '../api-client';
import type { Me, SignInResponse, StatusResponse } from '../api-types';
import { AUTH_STRATEGY } from './auth-strategy';
import { PENDING_LOGOUT_MARKER } from './pending-logout-marker';

/**
 * Sign-in endpoints. The response body (with its CSRF or bearer tokens) goes straight to the
 * active strategy; callers only ever receive the user.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiClient);
  private readonly strategy = inject(AUTH_STRATEGY);
  private readonly marker = inject(PENDING_LOGOUT_MARKER);
  private epoch = 0;
  private completion: Promise<boolean> | null = null;

  register(email: string, password: string, displayName?: string): Promise<StatusResponse> {
    return this.api.request({
      method: 'POST',
      path: '/auth/register',
      body: { email, password, mode: this.strategy.mode, display_name: displayName ?? null },
      auth: false,
    });
  }

  requestMagicLink(email: string): Promise<StatusResponse> {
    return this.api.request({
      method: 'POST',
      path: '/auth/magic-link',
      body: { email },
      auth: false,
    });
  }

  verifyMagicLink(token: string, password?: string): Promise<Me> {
    return this.signIn('/auth/magic-link/verify', {
      token,
      mode: this.strategy.mode,
      ...(password === undefined ? {} : { password }),
    });
  }

  login(email: string, password: string): Promise<Me> {
    return this.signIn('/auth/login', { email, password, mode: this.strategy.mode });
  }

  /** Resolves only after the server confirms revocation and local credentials are removed. */
  async logout(): Promise<void> {
    await this.revoke('/auth/logout');
  }

  /** Revokes every session of the account; a failure is reported after the local sign-out. */
  async logoutEverywhere(): Promise<void> {
    await this.revoke('/auth/logout-all');
  }

  completePendingLogout(): Promise<boolean> {
    if (!this.marker.isSet()) return Promise.resolve(true);
    if (this.completion !== null) return this.completion;
    const epoch = this.epoch;
    const pending: Promise<boolean> = this.strategy
      .completePendingLogout()
      .then(
        () => {
          if (epoch === this.epoch) this.marker.clear();
          return !this.marker.isSet();
        },
        () => !this.marker.isSet(),
      )
      .finally(() => {
        if (this.completion === pending) this.completion = null;
      });
    this.completion = pending;
    return pending;
  }

  private async revoke(path: '/auth/logout' | '/auth/logout-all'): Promise<void> {
    this.marker.set();
    const epoch = ++this.epoch;
    this.completion = null;
    try {
      await this.strategy.logout(path);
      if (epoch === this.epoch) this.marker.clear();
    } catch (error) {
      if (epoch === this.epoch) this.marker.set();
      throw error;
    }
  }

  private async signIn(
    path: '/auth/login' | '/auth/magic-link/verify',
    body: Record<string, unknown>,
  ): Promise<Me> {
    const epoch = ++this.epoch;
    await this.completePendingLogout();
    if (epoch !== this.epoch) throw new Error('sign-in was superseded');
    const response = await this.api.request<SignInResponse>({
      method: 'POST',
      path,
      body,
      auth: false,
      credentials: this.strategy.mode === 'cookie' ? 'include' : 'omit',
    });
    if (epoch === this.epoch) await this.strategy.establish(response);
    return response.user;
  }
}
