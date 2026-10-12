import { TestBed } from '@angular/core/testing';
import { hangingBody } from '../testing/fake-fetch';
import { setupDataAccess } from '../testing/setup';
import { AUTH_STRATEGY } from './auth/auth-strategy';
import { AccountApi } from './endpoints';
import { HealthClient } from './health-client';

describe('body transport deadlines', () => {
  it('covers CSRF body reads with the request timeout', async () => {
    const h = setupDataAccess(false, 20);
    await TestBed.inject(AUTH_STRATEGY).restore();
    h.fake.on('POST', '/auth/csrf', hangingBody);
    await expect(TestBed.inject(AccountApi).addFavorite('l1')).rejects.toMatchObject({
      kind: 'timeout',
    });
    expect(h.fake.callsTo('PUT', '/me/favorites/l1')).toHaveLength(0);
  });

  it('covers refresh body reads with the request timeout', async () => {
    const h = setupDataAccess(true, 20);
    h.store.value = 'refresh-A';
    await TestBed.inject(AUTH_STRATEGY).restore();
    h.fake.on('POST', '/auth/refresh', hangingBody);
    await expect(TestBed.inject(AccountApi).me()).rejects.toMatchObject({ kind: 'timeout' });
    expect(h.store.value).toBe('refresh-A');
    expect(h.fake.callsTo('GET', '/me')).toHaveLength(0);
  });

  it('covers health body reads with the request timeout', async () => {
    const h = setupDataAccess(false, 20);
    h.fake.on('GET', '/health', hangingBody);
    await expect(TestBed.inject(HealthClient).check()).rejects.toMatchObject({ kind: 'timeout' });
  });
});
