import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConnectivityService } from './connectivity.service';
import { debounced } from './debounced';
import { distanceMeters, fold, formatDate, inBbox, lineMode } from './format';
import { CapacitorLocationSource } from './location';

describe('format helpers', () => {
  it('folds Turkish text for matching', () => {
    expect(fold('  İSTANBUL Şişli ')).toBe('istanbul sisli');
    expect(fold('DURAK')).toBe(fold('durak'));
    expect(fold('Işık')).toBe('isik');
  });

  it('formats dates per language and rejects junk', () => {
    expect(formatDate('2026-10-01T09:00:00Z', 'tr')).toBe('1 Ekim 2026');
    expect(formatDate('2026-10-01T09:00:00Z', 'en')).toBe('1 October 2026');
    expect(formatDate(null, 'tr')).toBeNull();
    expect(formatDate('yesterday', 'tr')).toBeNull();
  });

  it('measures distances, checks a bbox and coerces unknown modes', () => {
    expect(distanceMeters([34.01, 42.51], [34.03, 42.51])).toBeCloseTo(1639, -1);
    expect(inBbox([34.05, 42.54], [34.0, 42.5, 34.1, 42.58])).toBe(true);
    expect(inBbox([29, 41], [34.0, 42.5, 34.1, 42.58])).toBe(false);
    expect(lineMode('minibus')).toBe('minibus');
    expect(lineMode('roket')).toBe('dolmus');
  });
});

describe('debounced', () => {
  it('follows after the pause and passes an empty value at once', () => {
    vi.useFakeTimers();
    try {
      const source = signal('');
      const out = TestBed.runInInjectionContext(() => debounced(source, 200));
      source.set('or');
      TestBed.tick();
      vi.advanceTimersByTime(199);
      expect(out()).toBe('');
      vi.advanceTimersByTime(1);
      expect(out()).toBe('or');
      source.set('');
      TestBed.tick();
      expect(out()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ConnectivityService', () => {
  it('follows the online and offline events', () => {
    const service = TestBed.inject(ConnectivityService);
    window.dispatchEvent(new Event('offline'));
    expect(service.online()).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(service.online()).toBe(true);
  });
});

describe('CapacitorLocationSource', () => {
  const position = { coords: { latitude: 42.51, longitude: 34.09 } };

  function plugin(overrides: Record<string, unknown> = {}) {
    return {
      checkPermissions: vi.fn(async () => ({ location: 'prompt', coarseLocation: 'prompt' })),
      requestPermissions: vi.fn(async () => ({ location: 'granted', coarseLocation: 'granted' })),
      getCurrentPosition: vi.fn(async () => position),
      ...overrides,
    };
  }

  it('asks for coarse location on native and returns one fix', async () => {
    const p = plugin();
    const result = await new CapacitorLocationSource(true, p as never).locate();
    expect(p.requestPermissions).toHaveBeenCalledWith({ permissions: ['coarseLocation'] });
    expect(p.getCurrentPosition).toHaveBeenCalledWith(
      expect.objectContaining({ enableHighAccuracy: false }),
    );
    expect(result).toEqual({ kind: 'ok', lat: 42.51, lng: 34.09 });
  });

  it('stops at a native refusal', async () => {
    const p = plugin({
      requestPermissions: vi.fn(async () => ({ location: 'denied', coarseLocation: 'denied' })),
    });
    expect(await new CapacitorLocationSource(true, p as never).locate()).toEqual({
      kind: 'denied',
    });
    expect(p.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('maps the browser refusal and other failures', async () => {
    const denied = plugin({
      getCurrentPosition: vi.fn(async () => Promise.reject({ code: 1, message: 'User denied' })),
    });
    expect(await new CapacitorLocationSource(false, denied as never).locate()).toEqual({
      kind: 'denied',
    });
    expect(denied.checkPermissions).not.toHaveBeenCalled();
    const timeout = plugin({
      getCurrentPosition: vi.fn(async () => Promise.reject({ code: 3, message: 'Timeout' })),
    });
    expect(await new CapacitorLocationSource(false, timeout as never).locate()).toEqual({
      kind: 'unavailable',
    });
  });
});
