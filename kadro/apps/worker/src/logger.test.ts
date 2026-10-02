import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, maskEmail } from './logger.js';

function captureLines(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  return { stream, lines };
}

describe('maskEmail', () => {
  it('keeps only the first character of local part and domain', () => {
    expect(maskEmail('oyuncu@kadro.app')).toBe('o***@k***');
  });

  it('fully redacts malformed or non-string values', () => {
    expect(maskEmail('no-at-sign')).toBe('[REDACTED]');
    expect(maskEmail(42)).toBe('[REDACTED]');
  });
});

describe('createLogger', () => {
  it('never writes credentials, tokens or raw e-mail addresses', () => {
    const { stream, lines } = captureLines();
    const logger = createLogger({ level: 'info', buildSha: 'local', appEnv: 'local' }, stream);

    logger.info(
      {
        req: {
          headers: { authorization: 'Bearer abc.def.ghi', cookie: '__Host-kadro_session=s3cr3t' },
        },
        user: { email: 'kaptan@example.com', password: 'correct horse battery' },
        session: { token: 'tok_123', refreshToken: 'rt_456' },
      },
      'login attempt',
    );

    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    for (const secret of [
      'abc.def.ghi',
      's3cr3t',
      'kaptan@example.com',
      'correct horse battery',
      'tok_123',
      'rt_456',
    ]) {
      expect(line).not.toContain(secret);
    }
    const entry = JSON.parse(line) as { user: { email: string }; service: string };
    expect(entry.user.email).toBe('k***@e***');
    expect(entry.service).toBe('kadro-worker');
  });
});
