import { act, render } from '@testing-library/react-native/pure';
import { describe, expect, it } from 'vitest';

import { type AsyncAction, useAsyncAction } from '../src/auth/use-async-action';
import { deferred } from './support/deferred';

function Harness({ onAction }: { readonly onAction: (action: AsyncAction) => void }) {
  onAction(useAsyncAction());
  return null;
}

async function mount() {
  let latest: AsyncAction | null = null;
  const view = await render(<Harness onAction={(action) => (latest = action)} />);
  return {
    action: (): AsyncAction => {
      if (latest === null) {
        throw new Error('not rendered');
      }
      return latest;
    },
    view,
  };
}

describe('useAsyncAction', () => {
  it('runs one task at a time: a second call while one is running does nothing', async () => {
    const { action } = await mount();
    const release = deferred();
    let started = 0;
    const task = async (): Promise<void> => {
      started += 1;
      await release.promise;
    };

    const first = action().run(task);
    const second = action().run(task);
    const third = action().run(task);
    expect(started).toBe(1);
    await expect(second).resolves.toBe(false);
    await expect(third).resolves.toBe(false);

    release.resolve();
    await expect(first).resolves.toBe(true);
    // Free again once the first run is over.
    release.resolve();
    await expect(action().run(task)).resolves.toBe(true);
    expect(started).toBe(2);
  });

  it('keeps the failure of the last run and clears it on the next run', async () => {
    const { action } = await mount();
    const failure = new Error('boom');
    await act(async () => {
      await expect(action().run(() => Promise.reject(failure))).resolves.toBe(false);
    });
    expect(action().error).toBe(failure);
    await act(async () => {
      await expect(action().run(async () => undefined)).resolves.toBe(true);
    });
    expect(action().error).toBeNull();
  });
});
