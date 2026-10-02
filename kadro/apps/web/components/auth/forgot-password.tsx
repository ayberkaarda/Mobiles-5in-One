'use client';

import Link from 'next/link';
import { type FormEvent, useReducer, useRef, useState } from 'react';

import { emailProblem } from '../../lib/client/a11y';
import { buildApiRequest } from '../../lib/client/api';
import { canSubmit, flowReducer, IDLE } from '../../lib/client/flow';
import { PAGE_COPY } from '../../lib/client/messages';
import { PAGE_PATHS } from '../../lib/client/redirects';
import styles from './auth.module.css';
import { EmailField, StatusMessage, SubmitButton } from './fields';
import { sendFromPage, useFocusOn, useHydrated } from './hooks';

const STATUS_ID = 'forgot-status';

/**
 * `/sifremi-unuttum` (ADR-0015): the API answers 202 for every address, and the page shows the
 * same confirmation for every address.
 */
export function ForgotPassword() {
  const hydrated = useHydrated();
  const [state, dispatch] = useReducer(flowReducer, IDLE);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useFocusOn(statusRef, state.status === 'success' ? 'success' : null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit(state)) {
      return;
    }
    const problem = emailProblem(email);
    if (problem !== null) {
      setFieldError(problem);
      emailRef.current?.focus();
      return;
    }
    setFieldError(null);
    dispatch({ type: 'submit' });
    void sendFromPage(buildApiRequest('forgot', { email: email.trim() })).then((outcome) => {
      dispatch({ type: 'settled', outcome, endpoint: 'forgot' });
    });
  };

  return (
    <>
      <StatusMessage id={STATUS_ID} state={state} copy={PAGE_COPY.forgot} statusRef={statusRef} />
      {state.status === 'success' ? (
        <div className={styles.actions}>
          <Link href={PAGE_PATHS.login} className={styles.buttonLink}>
            Giriş sayfasına dön
          </Link>
        </div>
      ) : (
        <form className={styles.form} method="post" noValidate onSubmit={onSubmit}>
          <EmailField
            id="email"
            label="E-posta"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            error={fieldError}
            extraDescribedBy={state.status === 'failure' ? STATUS_ID : null}
            inputRef={emailRef}
          />
          <SubmitButton
            label="Sıfırlama bağlantısı gönder"
            busyLabel="Gönderiliyor…"
            busy={state.status === 'pending'}
            hydrated={hydrated}
          />
          <Link href={PAGE_PATHS.login} className={styles.link}>
            Giriş sayfasına dön
          </Link>
        </form>
      )}
    </>
  );
}
