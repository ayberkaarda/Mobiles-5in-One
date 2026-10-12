import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiError } from '@inecekvar/data-access';
import { AdminApi, type QueueEdit } from '../admin-api';
import { AdminSession } from '../admin-session';
import { ConfirmService } from '../dialogs/confirm.service';
import { StepUpService } from '../step-up/step-up.service';
import { QueueStore, REASON_MAX } from './queue.store';

export function queueEdit(overrides: Partial<QueueEdit> = {}): QueueEdit {
  return {
    id: 'e1',
    kind: 'fare_update',
    state: 'pending',
    payload: { kind: 'fare_update', line: 'l1', base_version_no: 1, fare_minor: 3000 },
    diff: { fare_minor: { from: 2500, to: 3000 } },
    reason: null,
    created_at: '2026-10-12T08:00:00Z',
    reviewed_at: null,
    city: 'ornek-test-sehri',
    author: 'Katkıcı',
    current_geometry: null,
    proposed_geometry: null,
    ...overrides,
  };
}

function setup(api: Partial<Record<keyof AdminApi, unknown>> = {}, confirmAnswer = true) {
  const generation = signal(0);
  const fake = {
    queue: vi.fn(async () => [queueEdit(), queueEdit({ id: 'mine', author: 'Ben' })]),
    myEdits: vi.fn(async () => [{ id: 'mine' }]),
    approve: vi.fn(async () => ({})),
    reject: vi.fn(async () => ({})),
    ...api,
  };
  const stepUp = { run: vi.fn(<T>(action: () => Promise<T>) => action()) };
  const confirm = { ask: vi.fn(async () => confirmAnswer) };
  TestBed.configureTestingModule({
    providers: [
      QueueStore,
      { provide: AdminApi, useValue: fake },
      { provide: AdminSession, useValue: { generation } },
      { provide: StepUpService, useValue: stepUp },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  const store = TestBed.inject(QueueStore);
  TestBed.tick();
  return { store, fake, generation, stepUp, confirm };
}

afterEach(() => TestBed.resetTestingModule());

describe('QueueStore', () => {
  it('loads the queue and marks the reviewer’s own proposals', async () => {
    const { store } = setup();
    await store.load();
    expect(store.count()).toBe(2);
    expect(store.isOwn('mine')).toBe(true);
    expect(store.isOwn('e1')).toBe(false);
  });

  it('blocks approving an own proposal without calling the API', async () => {
    const { store, fake } = setup();
    await store.load();
    await store.approve(queueEdit({ id: 'mine' }));
    expect(fake.approve).not.toHaveBeenCalled();
    expect(store.notice()?.text).toContain('Kendi önerini onaylayamazsın');
  });

  it('shows the API refusal when the server rejects a self-approval the UI did not know about', async () => {
    const { store } = setup({
      approve: vi.fn().mockRejectedValue(new ApiError('problem', 403, 'auth.forbidden', 'r')),
    });
    await store.load();
    await store.approve(queueEdit());
    expect(store.notice()).toMatchObject({ tone: 'error', editId: 'e1' });
    expect(store.notice()?.text).toContain('kendi önerini onaylayamazsın');
    expect(store.count()).toBe(2);
  });

  it('approves, removes the item and reports the new version', async () => {
    const { store, fake } = setup();
    await store.load();
    await store.approve(queueEdit());
    expect(fake.approve).toHaveBeenCalledExactlyOnceWith('e1');
    expect(store.items().map((item) => item.id)).toEqual(['mine']);
    expect(store.notice()?.tone).toBe('ok');
  });

  it('ignores a second click while a decision is in flight', async () => {
    let finish!: () => void;
    const approve = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { store } = setup({ approve });
    await store.load();
    const first = store.approve(queueEdit());
    await Promise.resolve();
    expect(store.busy().has('e1')).toBe(true);
    await store.approve(queueEdit());
    finish();
    await first;
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation before a retirement and goes through the step-up', async () => {
    const { store, fake, confirm, stepUp } = setup();
    await store.load();
    await store.approve(queueEdit({ kind: 'retire' }));
    expect(confirm.ask).toHaveBeenCalledTimes(1);
    expect(stepUp.run).toHaveBeenCalledTimes(1);
    expect(fake.approve).toHaveBeenCalledTimes(1);
    expect(store.notice()?.text).toBe('Hat kaldırıldı.');
  });

  it('does nothing when the retirement is not confirmed', async () => {
    const { store, fake } = setup({}, false);
    await store.load();
    await store.approve(queueEdit({ kind: 'retire' }));
    expect(fake.approve).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(REASON_MAX + 1)])(
    'requires a bounded reason (%#)',
    async (reason) => {
      const { store, fake } = setup();
      await store.load();
      expect(await store.reject(queueEdit(), reason)).toBe(false);
      expect(fake.reject).not.toHaveBeenCalled();
    },
  );

  it('sends the trimmed reason', async () => {
    const { store, fake } = setup();
    await store.load();
    expect(await store.reject(queueEdit(), '  Ücret tarifesi eski.  ')).toBe(true);
    expect(fake.reject).toHaveBeenCalledExactlyOnceWith('e1', 'Ücret tarifesi eski.');
  });

  it('empties everything when the account changes', async () => {
    const { store, generation } = setup();
    await store.load();
    store.notice.set({ tone: 'ok', text: 'x' });
    generation.set(1);
    TestBed.tick();
    expect(store.items()).toEqual([]);
    expect(store.ownIds().size).toBe(0);
    expect(store.notice()).toBeNull();
    expect(store.loaded()).toBe(false);
  });

  it('drops a load that finishes after the account changed', async () => {
    let answer!: (value: QueueEdit[]) => void;
    const { store, generation } = setup({
      queue: vi.fn(() => new Promise<QueueEdit[]>((resolve) => (answer = resolve))),
    });
    const loading = store.load();
    generation.set(1);
    TestBed.tick();
    answer([queueEdit()]);
    await loading;
    expect(store.items()).toEqual([]);
  });
});
