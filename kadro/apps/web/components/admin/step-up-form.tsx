'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

import { normalizeTotpCode } from '../../lib/admin/client-api';
import { useHydrated } from '../auth/hooks';
import styles from './admin.module.css';
import { MutationStatus, TotpField } from './fields';
import { ADMIN_PATHS } from './paths';
import { useAdminMutation } from './use-admin-mutation';

const STATUS_ID = 'step-up-status';

/**
 * `/admin/dogrulama`: opens the 15-minute step-up window of this web session with a TOTP code
 * (`POST admin/step-up`), then the panel.
 */
export function StepUpForm({ csrfCookieName }: { readonly csrfCookieName: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const { state, run } = useAdminMutation(csrfCookieName);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [notEnrolled, setNotEnrolled] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const totpCode = normalizeTotpCode(code);
    if (totpCode === null) {
      setCodeError('6 haneli kodu yaz.');
      codeRef.current?.focus();
      return;
    }
    setCodeError(null);
    void run({ kind: 'stepUp', body: { totpCode } }).then((outcome) => {
      if (outcome?.kind === 'ok') {
        router.replace(ADMIN_PATHS.venues);
        return;
      }
      setCode('');
      setNotEnrolled(outcome?.kind === 'problem' && outcome.code === 'totp_not_enrolled');
    });
  };

  const busy = state.status === 'pending' || state.status === 'success';
  return (
    <>
      <MutationStatus
        id={STATUS_ID}
        state={state}
        pending="Kod doğrulanıyor…"
        success="Doğrulandı. Panele geçiliyor…"
      />
      <form className={styles.form} method="post" noValidate onSubmit={onSubmit}>
        <TotpField
          id="totp-code"
          label="Doğrulama kodu"
          value={code}
          onChange={setCode}
          error={codeError}
          inputRef={codeRef}
        />
        <button type="submit" className={styles.button} disabled={!hydrated} aria-disabled={busy}>
          {busy ? 'Doğrulanıyor…' : 'Doğrula'}
        </button>
      </form>
      <p className={styles.hint}>
        {notEnrolled
          ? 'Önce doğrulama uygulamanı kurman gerekiyor. '
          : 'Uygulaman kurulu değil mi? '}
        <Link href={ADMIN_PATHS.enroll} className={styles.link}>
          Doğrulama uygulamasını kur
        </Link>
      </p>
    </>
  );
}
