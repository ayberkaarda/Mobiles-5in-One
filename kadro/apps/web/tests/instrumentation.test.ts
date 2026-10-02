import { beforeEach, describe, expect, it, vi } from 'vitest';

const installNodeProcessHandlers = vi.fn();
const warmUp = vi.fn(() => Promise.resolve());

vi.mock('#process-handlers', () => ({ installNodeProcessHandlers }));
vi.mock('#auth-warm-up', () => ({ warmUp }));

beforeEach(() => {
  installNodeProcessHandlers.mockClear();
  warmUp.mockClear();
});

describe('instrumentation register', () => {
  it('installs the process-level handlers and warms up authentication', async () => {
    const { register } = await import('../instrumentation');
    await register();
    expect(installNodeProcessHandlers).toHaveBeenCalledTimes(1);
    expect(warmUp).toHaveBeenCalledTimes(1);
  });
});
