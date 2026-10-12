import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideIonicAngular } from '@ionic/angular';
import { ApiError, Edit } from '@inecekvar/data-access';
import { LicenceGate } from '../auth/licence-gate';
import { CityStore } from '../city/city.store';
import { MAP_LIBRARY_LOADER } from '../map/map-library';
import {
  catalogTesting,
  fakeContributions,
  FakeContributions,
  FakeSession,
  MemoryPreferences,
  SAMPLE_CITY,
  settle,
} from '../testing/catalog.fixtures';
import {
  contributeTesting,
  FakeClock,
  FakePositions,
  FakeWakeLock,
  walk,
} from '../testing/contribute.fixtures';
import { i18nTesting } from '../testing/i18n.testing';
import { ContributePage } from './contribute.page';
import { ProposalPage } from './proposal.page';
import { ProposalsPage } from './proposals.page';
import { RecorderPage } from './recorder.page';

@Component({ template: '<p>ok</p>' })
class Landing {}

interface Options {
  licence?: boolean;
  signedIn?: boolean;
  contributions?: FakeContributions;
}

async function open(url: string, options: Options = {}) {
  const session = new FakeSession();
  if (options.signedIn !== false) session.signIn('user-a', options.licence ?? true);
  const contributions = options.contributions ?? fakeContributions();
  const positions = new FakePositions();
  const clock = new FakeClock();
  TestBed.configureTestingModule({
    imports: [i18nTesting()],
    providers: [
      provideIonicAngular({}),
      provideRouter([
        { path: 'katki', component: ContributePage },
        { path: 'katki/kayit', component: RecorderPage },
        { path: 'katki/oneri', component: ProposalPage },
        { path: 'katki/onerilerim', component: ProposalsPage },
        { path: 'giris', component: Landing },
        { path: 'giris/kayit', component: Landing },
      ]),
      ...catalogTesting({ session, contributions, prefs: new MemoryPreferences() }),
      ...contributeTesting(positions, new FakeWakeLock(), clock),
      { provide: MAP_LIBRARY_LOADER, useValue: () => Promise.reject(new Error('no WebGL')) },
    ],
  });
  await TestBed.inject(CityStore).select(SAMPLE_CITY.slug);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle(harness.fixture);
  const root = harness.routeNativeElement as HTMLElement;
  return {
    harness,
    root,
    session,
    contributions,
    positions,
    clock,
    router: TestBed.inject(Router),
  };
}

async function type(
  harness: RouterTestingHarness,
  input: HTMLInputElement | HTMLTextAreaElement | null | undefined,
  value: string,
) {
  if (!input) throw new Error('missing input');
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await settle(harness.fixture);
}

async function click(harness: RouterTestingHarness, el: Element | null | undefined) {
  if (!el) throw new Error('missing element');
  (el as HTMLElement).click();
  await settle(harness.fixture);
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
const buttonByText = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => text(b) === label);

describe('Katkı hub', () => {
  it('invites a guest to sign in or register', async () => {
    const { root } = await open('/katki', { signedIn: false });
    expect(root.querySelector('[data-state="guest"]')).not.toBeNull();
    expect(root.querySelectorAll('.badge').length).toBe(4);
    expect(root.querySelector('a[href^="/giris?sonra=%2Fkatki"]')).not.toBeNull();
  });

  it('offers the line proposals when opened from a line page', async () => {
    const { root } = await open(`/katki?hat=ornek-hat-1&city=${SAMPLE_CITY.slug}`);
    const links = Array.from(root.querySelectorAll('.line-actions a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual([
      `/katki/oneri?tur=update_line&hat=ornek-hat-1&city=${SAMPLE_CITY.slug}`,
      `/katki/oneri?tur=fare_update&hat=ornek-hat-1&city=${SAMPLE_CITY.slug}`,
      `/katki/oneri?tur=retire&hat=ornek-hat-1&city=${SAMPLE_CITY.slug}`,
    ]);
    expect(text(root.querySelector('.who'))).toContain('Lisans kabul edildi');
  });
});

describe('proposal page', () => {
  it('shows field errors and sends nothing when a new line is incomplete', async () => {
    const { harness, root, contributions } = await open('/katki/oneri?tur=new_line');
    await click(harness, root.querySelector('button[type="submit"]'));
    expect(root.querySelectorAll('.iv-error').length).toBeGreaterThanOrEqual(4);
    expect(contributions.proposeEdit.calls).toHaveLength(0);
  });

  it('builds a new line with ordered stops and sends it', async () => {
    const { harness, root, contributions, router } = await open('/katki/oneri?tur=new_line');
    await type(harness, root.querySelector<HTMLInputElement>('#iv-code'), 'ORN-9');
    await type(harness, root.querySelector<HTMLInputElement>('#iv-name'), 'Yeni hat');
    await click(harness, buttonByText(root, 'Minibüs'));
    for (const name of ['Durak 1-1', 'Durak 1-2']) {
      await type(harness, root.querySelector<HTMLInputElement>('#iv-stop-search'), name);
      await click(harness, root.querySelector('.results button'));
    }
    expect(Array.from(root.querySelectorAll('.chosen li > span')).map(text)).toEqual([
      '[ÖRNEK] Durak 1-1',
      '[ÖRNEK] Durak 1-2',
    ]);
    await type(harness, root.querySelector<HTMLInputElement>('#iv-fare'), '30');
    await click(harness, root.querySelector('button[type="submit"]'));
    expect(contributions.proposeEdit.calls[0]?.[0]).toMatchObject({
      kind: 'new_line',
      city: SAMPLE_CITY.slug,
      code: 'ORN-9',
      name: 'Yeni hat',
      mode: 'minibus',
      stop_ids: ['stop-1-1', 'stop-1-2'],
      fare_minor: 3000,
      photo_id: null,
    });
    expect(router.url).toBe('/katki/onerilerim?yeni=1');
  });

  it('starts an update from the published version and sends only the change', async () => {
    const { harness, root, contributions } = await open(
      `/katki/oneri?tur=update_line&hat=ornek-hat-1&city=${SAMPLE_CITY.slug}`,
    );
    expect(text(root.querySelector('[data-target="line"]'))).toContain('ORN-1');
    expect(root.querySelector<HTMLInputElement>('#iv-fare')?.value).toBe('25');
    await type(harness, root.querySelector<HTMLInputElement>('#iv-hours'), '06:00-22:00');
    await click(harness, root.querySelector('button[type="submit"]'));
    expect(contributions.proposeEdit.calls[0]?.[0]).toEqual({
      kind: 'update_line',
      line: 'line-1',
      base_version_no: 1,
      changes: { hours_text: '06:00-22:00' },
      photo_id: null,
    });
  });

  it('shows the current fare with its date and counts down a 429', async () => {
    const contributions = fakeContributions();
    contributions.proposeEdit.impl = async () => {
      throw new ApiError('rate_limited', 429, 'rate_limited', 'req', null, 3600);
    };
    const { harness, root } = await open(
      `/katki/oneri?tur=fare_update&hat=ornek-hat-1&city=${SAMPLE_CITY.slug}`,
      { contributions },
    );
    expect(text(root.querySelector('.current-fare'))).toBe(
      'Şu anki ücret ₺25,00 · son güncelleme 1 Ekim 2026',
    );
    await type(harness, root.querySelector<HTMLInputElement>('#iv-fare'), '27,50');
    await click(harness, root.querySelector('button[type="submit"]'));
    expect(contributions.proposeEdit.calls[0]?.[0]).toMatchObject({ fare_minor: 2750 });
    expect(root.textContent).toContain(
      'Bugünkü öneri sınırına ulaştın. 3600 sn sonra yeniden dene.',
    );
    expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('asks for the licence first and sends nothing when it is declined', async () => {
    const { harness, root, contributions } = await open(
      `/katki/oneri?tur=retire&hat=ornek-hat-1&city=${SAMPLE_CITY.slug}`,
      { licence: false },
    );
    await type(harness, root.querySelector<HTMLTextAreaElement>('#iv-reason'), 'Hat kalktı');
    await click(harness, root.querySelector('button[type="submit"]'));
    const gate = TestBed.inject(LicenceGate);
    expect(gate.open()).toBe(true);
    gate.decline();
    await settle(harness.fixture);
    expect(contributions.proposeEdit.calls).toHaveLength(0);
  });

  it('uploads a stop sign photo and attaches its id to a new stop', async () => {
    const { harness, root, contributions } = await open('/katki/oneri?tur=new_stop');
    await type(harness, root.querySelector<HTMLInputElement>('#iv-stop-name'), 'Fırın önü');
    await click(harness, buttonByText(root, 'Konumumu kullan'));
    const input = root.querySelector<HTMLInputElement>('input[type="file"]');
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], 'tabela.jpg', {
      type: 'image/jpeg',
    });
    Object.defineProperty(input, 'files', { value: [photo], configurable: true });
    input?.dispatchEvent(new Event('change'));
    await settle(harness.fixture);
    expect(root.querySelector('[data-photo="done"]')).not.toBeNull();
    expect(contributions.presignPhoto.calls[0]?.[0]).toEqual({
      kind: 'stop_sign',
      content_type: 'image/jpeg',
      byte_size: 6,
    });
    await click(harness, root.querySelector('button[type="submit"]'));
    expect(contributions.proposeEdit.calls[0]?.[0]).toEqual({
      kind: 'new_stop',
      city: SAMPLE_CITY.slug,
      name: 'Fırın önü',
      location: [34.09, 42.51],
      stop_kind: 'informal',
      photo_id: '01920000-0000-7000-8000-0000000000aa',
    });
  });

  it('refuses a renamed PNG without uploading', async () => {
    const { harness, root, contributions } = await open('/katki/oneri?tur=new_stop');
    const input = root.querySelector<HTMLInputElement>('input[type="file"]');
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], 'x.jpg', {
      type: 'image/jpeg',
    });
    Object.defineProperty(input, 'files', { value: [png], configurable: true });
    input?.dispatchEvent(new Event('change'));
    await settle(harness.fixture);
    expect(root.textContent).toContain('Yalnızca JPEG ya da WebP fotoğraf yüklenebilir.');
    expect(contributions.presignPhoto.calls).toHaveLength(0);
  });
});

describe('my proposals', () => {
  const edit = (overrides: Partial<Edit>): Edit => ({
    id: 'e',
    kind: 'new_line',
    state: 'pending',
    payload: { code: 'ORN-9', name: 'Yeni hat' },
    diff: null,
    reason: null,
    created_at: '2026-10-11T10:00:00Z',
    reviewed_at: null,
    city: SAMPLE_CITY.slug,
    ...overrides,
  });

  it('lists each state and shows a rejection reason as plain text', async () => {
    const contributions = fakeContributions();
    contributions.myEdits.impl = async () => [
      edit({ id: 'e1' }),
      edit({ id: 'e2', kind: 'fare_update', state: 'approved', payload: { fare_minor: 2750 } }),
      edit({
        id: 'e3',
        kind: 'new_stop',
        state: 'rejected',
        payload: { name: '<img src=x onerror=alert(1)>' },
        reason: '<b>Bu durak zaten var</b>',
      }),
    ];
    const { root } = await open('/katki/onerilerim?yeni=1', { contributions });
    expect(root.textContent).toContain('Önerin moderatörlere gitti.');
    const items = Array.from(root.querySelectorAll('.list > li'));
    expect(items.map((i) => i.getAttribute('data-state'))).toEqual([
      'pending',
      'approved',
      'rejected',
    ]);
    expect(items.map((i) => text(i.querySelector('iv-status-badge')))).toEqual([
      'Bekliyor',
      'Onaylandı',
      'Reddedildi',
    ]);
    expect(text(items[0]?.querySelector('.subject'))).toBe('ORN-9 · Yeni hat');
    expect(text(items[1]?.querySelector('.subject'))).toBe('₺27,50');
    expect(items[2]?.querySelector('img, b')).toBeNull();
    expect(text(items[2]?.querySelector('.subject'))).toBe('<img src=x onerror=alert(1)>');
    expect(text(items[2]?.querySelector('.reason'))).toBe(
      'Moderatör notu <b>Bu durak zaten var</b>',
    );
  });

  it('offers a retry when the list cannot be loaded', async () => {
    const contributions = fakeContributions();
    contributions.myEdits.impl = async () => {
      throw new ApiError('network', 0, 'network', 'req');
    };
    const { root } = await open('/katki/onerilerim', { contributions });
    expect(root.textContent).toContain('İnternet yok. Bağlantı gelince yeniden dene.');
  });
});

describe('recorder page', () => {
  it('walks from the privacy note through recording and stop marking to the review', async () => {
    const { harness, root, positions, clock } = await open('/katki/kayit');
    expect(root.querySelector('[data-view="idle"]')).not.toBeNull();
    expect(text(root.querySelector('.privacy'))).toContain('ilk ve son 200 metresini');
    await click(harness, buttonByText(root, 'Kaydı başlat'));
    expect(root.querySelector('[data-view="recording"]')).not.toBeNull();
    expect(buttonByText(root, 'Durak işaretle')?.hasAttribute('disabled')).toBe(true);
    for (const [lng, lat] of walk(6)) {
      clock.advance(1000);
      positions.emit(lng, lat);
    }
    await settle(harness.fixture);
    expect(text(root.querySelector('[data-stat="points"]'))).toBe('6');
    expect(text(root.querySelector('[data-stat="distance"]'))).toBe('0,08 km');
    await click(harness, buttonByText(root, 'Durak işaretle'));
    await type(harness, root.querySelector<HTMLInputElement>('#iv-rec-name'), 'Köşe');
    await click(harness, buttonByText(root, 'Kaydet'));
    expect(text(root.querySelector('.meta'))).toContain('1 durak işaretli');
    await click(harness, buttonByText(root, 'Bitir'));
    expect(root.querySelector('[data-view="review"]')).not.toBeNull();
    expect(root.querySelector<HTMLInputElement>('#iv-rec-stop-0')?.value).toBe('Köşe');
    expect(buttonByText(root, 'İzi gönder')?.hasAttribute('disabled')).toBe(false);
  });
});
