'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useReducer, useRef, useState } from 'react';

import { emailProblem } from '../../lib/client/a11y';
import { buildApiRequest } from '../../lib/client/api';
import { canSubmit, failureFor, flowReducer, IDLE } from '../../lib/client/flow';
import { PAGE_COPY } from '../../lib/client/messages';
import { type AfterLoginTarget, PAGE_PATHS } from '../../lib/client/redirects';
import styles from './auth.module.css';
import { EmailField, PasswordField, StatusMessage, SubmitButton } from './fields';
import { sendFromPage, useHydrated } from './hooks';

const STATUS_ID = 'login-status';

/**
 * `/giris`: web password sign-in. The API sets the `__Host-` session and CSRF cookies; the page
 * keeps nothing. A successful sign-in also cancels a pending account deletion (ADR-0032).
 * `next` is already one of the fixed targets (`afterLoginTarget`), never raw input.
 */
export function LoginForm({ next }: { readonly next: AfterLoginTarget }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [state, dispatch] = useReducer(flowReducer, IDLE);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit(state)) {
      return;
    }
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
    dispatch({ type: 'submit' });
    void sendFromPage(buildApiRequest('login', { email: email.trim(), password })).then(
      (outcome) => {
        dispatch({ type: 'settled', outcome, endpoint: 'login' });
        if (failureFor('login', outcome) === null) {
          router.replace(next);
        } else {
          setPassword('');
        }
      },
    );
  };

  const failed = state.status === 'failure' ? STATUS_ID : null;
  return (
    <>
      <StatusMessage id={STATUS_ID} state={state} copy={PAGE_COPY.login} />
      <form className={styles.form} method="post" noValidate onSubmit={onSubmit}>
        <EmailField
          id="email"
          label="E-posta"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          error={emailError}
          extraDescribedBy={failed}
          inputRef={emailRef}
        />
        <PasswordField
          id="password"
          label="Şifre"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={passwordError}
          extraDescribedBy={failed}
          inputRef={passwordRef}
        />
        <SubmitButton
          label="Giriş yap"
          busyLabel="Giriş yapılıyor…"
          busy={state.status === 'pending' || state.status === 'success'}
          hydrated={hydrated}
        />
        <Link href={PAGE_PATHS.forgot} className={styles.link}>
          Şifremi unuttum
        </Link>
      </form>
    </>
  );
}
