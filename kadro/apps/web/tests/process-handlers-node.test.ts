import { describe, expect, it, vi } from 'vitest';

const installProcessHandlers = vi.fn();
vi.mock('../lib/server/process-handlers', () => ({ installProcessHandlers }));

describe('Node.js runtime variant', () => {
  it('installs the handlers with the redacting fallback logger', async () => {
    const { installNodeProcessHandlers } = await import('../lib/server/process-handlers.node');
    const { fallbackLogger } = await import('../lib/server/logging');
    installNodeProcessHandlers();
    expect(installProcessHandlers).toHaveBeenCalledExactlyOnceWith({ logger: fallbackLogger() });
  });
});
