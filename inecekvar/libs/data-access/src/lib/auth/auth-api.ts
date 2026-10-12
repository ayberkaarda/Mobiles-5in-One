import { inject, Injectable } from '@angular/core';
import { ApiClient } from '../api-client';
import type { Me, SignInResponse, StatusResponse } from '../api-types';
import { AUTH_STRATEGY } from './auth-strategy';

/**
 * Sign-in endpoints. The response body (with its CSRF or bearer tokens) goes straight to the
 * active strategy; callers only ever receive the user.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiClient);
  private readonly strategy = inject(AUTH_STRATEGY);

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

  /** Ends this session on the server when reachable; local credentials are dropped regardless. */
  async logout(): Promise<void> {
    try {
      await this.api.request({ method: 'POST', path: '/auth/logout' });
    } catch {
      // Offline or already expired: the device forgets the session anyway.
    } finally {
      await this.strategy.clear();
    }
  }

  /** Revokes every session of the account; a failure is reported after the local sign-out. */
  async logoutEverywhere(): Promise<void> {
    try {
      await this.api.request({ method: 'POST', path: '/auth/logout-all' });
    } finally {
      await this.strategy.clear();
    }
  }

  private async signIn(
    path: '/auth/login' | '/auth/magic-link/verify',
    body: Record<string, unknown>,
  ): Promise<Me> {
    const response = await this.api.request<SignInResponse>({
      method: 'POST',
      path,
      body,
      auth: false,
    });
    await this.strategy.establish(response);
    return response.user;
  }
}
