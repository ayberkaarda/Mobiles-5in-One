'use client';

import { adminTotpEnrollResponseSchema, type AdminTotpEnrollResponse } from '@kadro/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

import { normalizeTotpCode } from '../../lib/admin/client-api';
import { PasswordField } from '../auth/fields';
import { useHydrated } from '../auth/hooks';
import styles from './admin.module.css';
import { MutationStatus, TotpField } from './fields';
import { formatDateTime } from './labels';
import { ADMIN_PATHS } from './paths';
import { QrCode } from './qr-code';
import { useAdminMutation } from './use-admin-mutation';

/** The secret in groups of four for manual entry. */
export function groupedSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * `/admin/totp-kurulum`: two-step enrollment of ADR-0064. The password is the re-authentication
 * proof of `POST admin/totp/enroll`; the response (shown once, kept only in this component's
 * memory) becomes a locally drawn QR code plus the secret for manual entry; a code from the app
 * confirms it (`POST admin/totp/confirm`), then the page moves on to the step-up.
 */
export function EnrollTotp({ csrfCookieName }: { readonly csrfCookieName: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const enroll = useAdminMutation(csrfCookieName);
  const confirm = useAdminMutation(csrfCookieName);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [pending, setPending] = useState<AdminTotpEnrollResponse | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const onEnroll = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length === 0) {
      setPasswordError('Şifreni yaz.');
      passwordRef.current?.focus();
      return;
    }
    setPasswordError(null);
    void enroll.run({ kind: 'totpEnroll', body: { password } }).then((outcome) => {
      setPassword('');
      if (outcome?.kind !== 'ok') {
        return;
      }
      const parsed = adminTotpEnrollResponseSchema.safeParse(outcome.body);
      if (parsed.success) {
        setPending(parsed.data);
      }
    });
  };

  const onConfirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const totpCode = normalizeTotpCode(code);
    if (totpCode === null) {
      setCodeError('6 haneli kodu yaz.');
      codeRef.current?.focus();
      return;
    }
    setCodeError(null);
    void confirm.run({ kind: 'totpConfirm', body: { totpCode } }).then((outcome) => {
      setCode('');
      if (outcome?.kind === 'ok') {
        setPending(null);
        router.replace(ADMIN_PATHS.stepUp);
      }
    });
  };

  if (pending === null) {
    const busy = enroll.state.status === 'pending' || enroll.state.status === 'success';
    return (
      <>
        <MutationStatus
          id="enroll-status"
          state={enroll.state}
          pending="Kurulum hazırlanıyor…"
          success="Kurulum bilgisi hazır."
        />
        <form className={styles.form} method="post" noValidate onSubmit={onEnroll}>
          <PasswordField
            id="enroll-password"
            label="Şifre"
            hint="Kurulumu başlatmak için hesabının şifresini yeniden gir."
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            error={passwordError}
            inputRef={passwordRef}
          />
          <button type="submit" className={styles.button} disabled={!hydrated} aria-disabled={busy}>
            {busy ? 'Hazırlanıyor…' : 'Kurulumu başlat'}
          </button>
        </form>
      </>
    );
  }

  const busy = confirm.state.status === 'pending' || confirm.state.status === 'success';
  return (
    <>
      <ol className={styles.lead}>
        <li>Doğrulama uygulamanla (ör. bir authenticator uygulaması) aşağıdaki kodu tara.</li>
        <li>Tarayamıyorsan anahtarı elle gir: SHA-1, 6 hane, 30 saniye.</li>
        <li>Uygulamanın gösterdiği kodu yazıp kurulumu tamamla.</li>
      </ol>
      <QrCode value={pending.otpauthUri} label="Doğrulama uygulaması için QR kodu" />
      <p className={styles.hint}>Anahtar (yalnızca bir kez gösterilir):</p>
      <p className={styles.secret} data-testid="totp-secret">
        {groupedSecret(pending.secret)}
      </p>
      <p className={styles.hint}>
        Son onay zamanı:{' '}
        <time dateTime={pending.confirmBy}>{formatDateTime(pending.confirmBy)}</time>
      </p>
      <MutationStatus
        id="confirm-status"
        state={confirm.state}
        pending="Kod doğrulanıyor…"
        success="Kurulum tamamlandı. Doğrulama adımına geçiliyor…"
      />
      <form className={styles.form} method="post" noValidate onSubmit={onConfirm}>
        <TotpField
          id="confirm-code"
          label="Uygulamadaki kod"
          value={code}
          onChange={setCode}
          error={codeError}
          inputRef={codeRef}
        />
        <button type="submit" className={styles.button} disabled={!hydrated} aria-disabled={busy}>
          {busy ? 'Doğrulanıyor…' : 'Kurulumu tamamla'}
        </button>
      </form>
    </>
  );
}
