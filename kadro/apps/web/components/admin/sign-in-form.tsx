'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

import { emailProblem } from '../../lib/client/a11y';
import { EmailField, PasswordField } from '../auth/fields';
import { useHydrated } from '../auth/hooks';
import styles from './admin.module.css';
import { MutationStatus } from './fields';
import { ADMIN_PATHS } from './paths';
import { useAdminMutation } from './use-admin-mutation';

const STATUS_ID = 'admin-sign-in-status';

/**
 * `/admin/giris`: password sign-in of staff accounts through `POST auth/login` (the API sets the
 * `__Host-` session and CSRF cookies), then the TOTP step-up page. Staff accounts that only use
 * Apple or Google sign in on the regular pages and come back here signed in.
 */
export function AdminSignInForm({ csrfCookieName }: { readonly csrfCookieName: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const { state, run } = useAdminMutation(csrfCookieName);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const emailIssue = emailProblem(email);
    const passwordIssue = password === '' ? 'Şifreni yaz.' : null;
    setEmailError(emailIssue);
    setPasswordError(passwordIssue);
    if (emailIssue !== null) {
      emailRef.current?.focus();
      return;
    }
    if (passwordIssue !== null) {
      passwordRef.current?.focus();
      return;
    }
    void run({ kind: 'login', body: { email: email.trim(), password } }).then((outcome) => {
      if (outcome?.kind === 'ok') {
        router.replace(ADMIN_PATHS.stepUp);
      } else if (outcome !== null) {
        setPassword('');
      }
    });
  };

  const busy = state.status === 'pending' || state.status === 'success';
  return (
    <>
      <MutationStatus
        id={STATUS_ID}
        state={state}
        pending="Giriş yapılıyor…"
        success="Giriş yaptın. Doğrulama adımına geçiliyor…"
      />
      <form className={styles.form} method="post" noValidate onSubmit={onSubmit}>
        <EmailField
          id="email"
          label="E-posta"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          error={emailError}
          extraDescribedBy={state.status === 'failure' ? STATUS_ID : null}
          inputRef={emailRef}
        />
        <PasswordField
          id="password"
          label="Şifre"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={passwordError}
          extraDescribedBy={state.status === 'failure' ? STATUS_ID : null}
          inputRef={passwordRef}
        />
        <button type="submit" className={styles.button} disabled={!hydrated} aria-disabled={busy}>
          {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
      </form>
    </>
  );
}
