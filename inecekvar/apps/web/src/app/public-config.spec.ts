import { PLATFORM_ID, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_PUBLIC_WEB_CONFIG,
  PUBLIC_CONFIG_STATE_KEY,
  PUBLIC_WEB_CONFIG,
  publicWebConfigFactory,
  PublicWebConfig,
} from './public-config';

afterEach(() => TestBed.resetTestingModule());

describe('public config hydration', () => {
  function read(value?: unknown) {
    const state = new TransferState();
    if (value !== undefined) {
      state.set(PUBLIC_CONFIG_STATE_KEY, value as PublicWebConfig);
    }
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: TransferState, useValue: state },
        { provide: PUBLIC_WEB_CONFIG, useFactory: publicWebConfigFactory },
      ],
    });
    return { config: TestBed.inject(PUBLIC_WEB_CONFIG), state };
  }

  it('uses and removes the public server config', () => {
    const expected = {
      canonicalOrigin: 'https://canonical.example',
      appOrigin: 'https://app.example',
      tilesOrigin: 'https://tiles.example',
      apiPublicBaseUrl: 'https://api.example/v1',
      appStoreId: '123456',
    };
    const { config, state } = read(expected);
    expect(config).toEqual(expected);
    expect(state.hasKey(PUBLIC_CONFIG_STATE_KEY)).toBe(false);
  });

  it.each([
    undefined,
    null,
    {},
    { ...DEFAULT_PUBLIC_WEB_CONFIG, canonicalOrigin: '//evil.example' },
    { ...DEFAULT_PUBLIC_WEB_CONFIG, apiPublicBaseUrl: 'https://name:pass@api.example/v1' },
    { ...DEFAULT_PUBLIC_WEB_CONFIG, appStoreId: 'invalid' },
    { ...DEFAULT_PUBLIC_WEB_CONFIG, appOrigin: 'https://app.example/path' },
    { ...DEFAULT_PUBLIC_WEB_CONFIG, appOrigin: 'https://name:pass@app.example' },
    { ...DEFAULT_PUBLIC_WEB_CONFIG, tilesOrigin: 'https://tiles.example/path' },
    { ...DEFAULT_PUBLIC_WEB_CONFIG, tilesOrigin: 12 },
  ])('falls back when public config is absent or invalid', (value) => {
    expect(read(value).config).toEqual(DEFAULT_PUBLIC_WEB_CONFIG);
  });

  it('accepts an absent tiles origin', () => {
    expect(read({ ...DEFAULT_PUBLIC_WEB_CONFIG, tilesOrigin: null }).config.tilesOrigin).toBeNull();
  });
});
