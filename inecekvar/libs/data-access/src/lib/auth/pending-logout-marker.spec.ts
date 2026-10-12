import { TestBed } from '@angular/core/testing';
import { PENDING_LOGOUT_MARKER } from './pending-logout-marker';

describe('PendingLogoutMarker', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('persists only a logout flag across marker instances', () => {
    const marker = TestBed.inject(PENDING_LOGOUT_MARKER);
    marker.set();
    expect(localStorage.getItem('iv.logout_pending')).toBe('1');
    TestBed.resetTestingModule();
    const restored = TestBed.inject(PENDING_LOGOUT_MARKER);
    expect(restored.isSet()).toBe(true);
    restored.clear();
    expect(localStorage.getItem('iv.logout_pending')).toBeNull();
  });

  it('keeps the logout flag in memory when web storage is unavailable', () => {
    const marker = TestBed.inject(PENDING_LOGOUT_MARKER);
    const fail = () => {
      throw new Error('storage unavailable');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(fail);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(fail);
    expect(marker.isSet()).toBe(false);
    marker.set();
    expect(marker.isSet()).toBe(true);
    marker.clear();
    expect(marker.isSet()).toBe(false);
  });
});
