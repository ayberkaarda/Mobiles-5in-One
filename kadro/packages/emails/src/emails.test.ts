import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  EmailDeliveryError,
  type EmailFetch,
  alreadyRegisteredMessage,
  createLogTransport,
  createResendTransport,
  deletionScheduledMessage,
  escapeHtml,
  passwordResetMessage,
  verifyEmailMessage,
} from './index.js';

const ORIGIN = 'https://kadro.app';

function generatedToken(): string {
  return randomBytes(32).toString('base64url');
}

describe('templates', () => {
  it('puts the token only into the URL fragment of the verification link', () => {
    const token = generatedToken();
    const email = verifyEmailMessage({ origin: ORIGIN, displayName: 'Ayşe', token });
    expect(email.text).toContain(`${ORIGIN}/e-posta-dogrula#token=${token}`);
    expect(email.text).not.toContain('?token=');
    expect(email.html).toContain(`/e-posta-dogrula#token=${token}`);
  });

  it('links the reset page with the token in the fragment', () => {
    const token = generatedToken();
    const email = passwordResetMessage({ origin: ORIGIN, displayName: 'Ayşe', token });
    expect(email.subject).toBe('Kadro: şifreni sıfırla');
    expect(email.text).toContain(`${ORIGIN}/sifre-sifirla#token=${token}`);
  });

  it('escapes a hostile display name in the HTML part', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const email = alreadyRegisteredMessage({ origin: ORIGIN, displayName: hostile });
    expect(email.html).not.toContain(hostile);
    expect(email.html).toContain(escapeHtml(hostile));
    expect(email.text).toContain(hostile);
  });

  it('shows the end of the deletion grace period in Istanbul time', () => {
    const email = deletionScheduledMessage({
      origin: ORIGIN,
      displayName: 'Mert',
      graceUntil: new Date('2026-10-08T18:00:00.000Z'),
    });
    expect(email.text).toContain('8 Ekim 2026 21:00');
    expect(email.text).toContain(`${ORIGIN}/giris`);
    expect(email.text).toContain(`${ORIGIN}/hesap-silme`);
    expect(email.text).not.toContain('#token=');
  });
});

describe('createResendTransport', () => {
  const message = {
    kind: 'verify_email',
    to: 'oyuncu@example.test',
    subject: 'konu',
    text: 'metin',
    html: '<p>metin</p>',
  } as const;

  function stubFetch(status: number): { fetch: EmailFetch; calls: Parameters<EmailFetch>[] } {
    const calls: Parameters<EmailFetch>[] = [];
    return {
      calls,
      fetch: (url, init) => {
        calls.push([url, init]);
        return Promise.resolve({ ok: status >= 200 && status < 300, status });
      },
    };
  }

  it('posts the message to the Resend emails endpoint with the API key', async () => {
    const apiKey = `re_${randomBytes(18).toString('base64url')}`;
    const { fetch, calls } = stubFetch(200);
    await createResendTransport({ apiKey, from: 'Kadro <bildirim@kadro.app>', fetch }).send(
      message,
    );
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] ?? [];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.headers.Authorization).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(init?.body ?? '{}')).toMatchObject({ to: [message.to], subject: 'konu' });
  });

  it('classifies provider answers as definite and retryable or not', async () => {
    const apiKey = `re_${randomBytes(18).toString('base64url')}`;
    for (const [status, retryable] of [
      [422, false],
      [429, true],
      [503, true],
    ] as const) {
      const { fetch } = stubFetch(status);
      const error = await createResendTransport({ apiKey, from: 'a@kadro.app', fetch })
        .send(message)
        .then(
          () => undefined,
          (reason: unknown) => reason,
        );
      expect(error).toBeInstanceOf(EmailDeliveryError);
      expect((error as EmailDeliveryError).definite).toBe(true);
      expect((error as EmailDeliveryError).retryable).toBe(retryable);
      expect((error as Error).message).not.toContain(apiKey);
    }
  });

  it('reports a network failure as an unknown, retryable outcome', async () => {
    const error = await createResendTransport({
      apiKey: `re_${randomBytes(18).toString('base64url')}`,
      from: 'a@kadro.app',
      fetch: () => Promise.reject(new Error('connection reset')),
    })
      .send(message)
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).definite).toBe(false);
    expect((error as EmailDeliveryError).retryable).toBe(true);
  });
});

describe('createLogTransport', () => {
  it('is refused outside the local environment', () => {
    for (const appEnv of ['preview', 'production']) {
      expect(() =>
        createLogTransport({ appEnv, logger: { info: () => undefined }, maskRecipient: (a) => a }),
      ).toThrow(/APP_ENV=local/);
    }
  });

  it('logs the masked recipient and the body locally', async () => {
    const lines: Record<string, unknown>[] = [];
    const transport = createLogTransport({
      appEnv: 'local',
      logger: { info: (fields) => lines.push(fields) },
      maskRecipient: () => 'o***@e***',
    });
    await transport.send({
      kind: 'password_reset',
      to: 'oyuncu@example.test',
      subject: 's',
      text: 'body',
      html: '<p>body</p>',
    });
    expect(lines).toEqual([
      { emailKind: 'password_reset', recipient: 'o***@e***', subject: 's', body: 'body' },
    ]);
  });
});
