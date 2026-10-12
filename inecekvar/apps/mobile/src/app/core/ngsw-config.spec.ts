import { Config, Filesystem, Generator } from '@angular/service-worker/config';
import config from '../../../ngsw-config.json';

describe('catalog service-worker cache', () => {
  it('excludes authenticated private queries from every built data group', async () => {
    const fs: Filesystem = {
      list: async () => [],
      read: async () => '',
      hash: async () => '',
      write: async () => undefined,
    };
    const manifest = (await new Generator(fs, '/').process(config as unknown as Config)) as {
      dataGroups: { patterns: string[] }[];
    };
    const url = new Request('https://host/api/v1/me?x=/api/v1/lines', {
      headers: { Authorization: 'Bearer test-session' },
    }).url;
    expect(
      manifest.dataGroups.some((group) =>
        group.patterns.some((pattern) => new RegExp(pattern).test(url)),
      ),
    ).toBe(false);
  });

  it('anchors catalog patterns before queries and retires the unsafe cache version', async () => {
    const fs: Filesystem = {
      list: async () => [],
      read: async () => '',
      hash: async () => '',
      write: async () => undefined,
    };
    const manifest = (await new Generator(fs, '/').process(config as unknown as Config)) as {
      dataGroups: { name: string; version: number; patterns: string[] }[];
    };
    const group = manifest.dataGroups.find((entry) => entry.name === 'catalog-reads');
    expect(group?.version).toBeGreaterThanOrEqual(2);
    const patterns = group?.patterns.map((pattern) => new RegExp(pattern)) ?? [];
    const matches = (url: string) => patterns.some((pattern) => pattern.test(url));
    for (const path of [
      '/cities',
      '/cities/istanbul',
      '/lines?city=istanbul',
      '/lines/istanbul/m2',
      '/stops/istanbul/x?y=1',
    ]) {
      expect(matches(`https://host/api/v1${path}`), path).toBe(true);
      expect(matches(`http://host/api/v1${path}`), path).toBe(true);
    }
    for (const path of [
      '/me',
      '/me?x=/api/v1/lines',
      '/me?next=https://host/api/v1/cities',
      '/proposals?q=/api/v1/stops/',
      '/auth/x/api/v1/lines',
      '/cities/istanbul/pack',
      '/cities/istanbul/tiles.pmtiles',
    ]) {
      expect(matches(`https://host/api/v1${path}`), path).toBe(false);
    }
  });
});
