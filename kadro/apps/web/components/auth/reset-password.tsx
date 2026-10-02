'use client';

import Link from 'next/link';
import { type FormEvent, useReducer, useRef, useState } from 'react';

import { newPasswordProblem, passwordProblemMessage } from '../../lib/client/a11y';
import { buildApiRequest } from '../../lib/client/api';
import {
  canSubmit,
  failureFor,
  type FlowEvent,
  type FlowState,
  flowReducer,
  IDLE,
} from '../../lib/client/flow';
import { PAGE_COPY, PASSWORD_RULE } from '../../lib/client/messages';
import { PAGE_PATHS } from '../../lib/client/redirects';
import { type CaptureSnapshot, pageTokenCapture } from '../../lib/client/token-capture';
import styles from './auth.module.css';
import { PasswordField, StatusMessage, SubmitButton } from './fields';
import { sendFromPage, useCapturedToken, useFocusOn } from './hooks';

const LINK_INVALID: FlowState = {
  status: 'failure',
  failure: 'link_invalid',
  retryAfterSeconds: null,
};
const STATUS_ID = 'reset-status';

async function reset(
  captured: CaptureSnapshot,
  token: string,
  password: string,
): Promise<FlowEvent> {
  const outcome = await sendFromPage(
    buildApiRequest('reset', { token, password }),
    captured.signal,
  );
  const failure = failureFor('reset', outcome);
  if (failure === null || failure === 'link_invalid') {
    // ADR-0040 step 5: the token is spent or useless; drop it from memory.
    pageTokenCapture.forget(captured.version);
  }
  return { type: 'settled', outcome, endpoint: 'reset' };
}

/**
 * `/sifre-sifirla#token=…` (ADR-0040): the new password is posted only when the user submits.
 * Success signs out every session (ADR-0025) and offers the sign-in page. A new link opened in the
 * same document, or a return from the back/forward cache, starts the form again from its token.
 */
export function ResetPassword() {
  const captured = useCapturedToken(PAGE_PATHS.reset);
  if (captured === null) {
    // Server render and hydration: the fragment has not been read yet.
    return <p className={styles.hint}>Bağlantı kontrol ediliyor…</p>;
  }
  return <ResetPasswordForm key={captured.version} captured={captured} />;
}

function ResetPasswordForm({ captured }: { readonly captured: CaptureSnapshot }) {
  const [state, dispatch] = useReducer(flowReducer, IDLE);
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const token = captured.token;

  const view: FlowState =
    state.status !== 'success' && token.kind !== 'valid' ? LINK_INVALID : state;
  const settled =
    view.status === 'success' || (view.status === 'failure' && view.failure === 'link_invalid');
  useFocusOn(statusRef, settled ? view.status : null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (token.kind !== 'valid' || !canSubmit(state)) {
      return;
    }
    const problem = newPasswordProblem(password);
    if (problem !== null) {
      setFieldError(passwordProblemMessage(problem));
      passwordRef.current?.focus();
      return;
    }
    setFieldError(null);
    dispatch({ type: 'submit' });
    void reset(captured, token.token, password).then((settledEvent) => {
      if (captured.signal.aborted) {
        // The token was released or replaced; this form is gone.
        return;
      }
      setPassword('');
      dispatch(settledEvent);
    });
  };

  return (
    <>
      <StatusMessage id={STATUS_ID} state={view} copy={PAGE_COPY.reset} statusRef={statusRef} />
      {view.status === 'success' ? (
        <div className={styles.actions}>
          <Link href={PAGE_PATHS.login} className={styles.buttonLink}>
            Giriş yap
          </Link>
        </div>
      ) : null}
      {view.status === 'failure' && view.failure === 'link_invalid' ? (
        <div className={styles.actions}>
          <Link href={PAGE_PATHS.forgot} className={styles.buttonLink}>
            Yeni bağlantı iste
          </Link>
        </div>
      ) : null}
      {view.status === 'idle' ||
      view.status === 'pending' ||
      (view.status === 'failure' && !settled) ? (
        <form className={styles.form} method="post" noValidate onSubmit={onSubmit}>
          <PasswordField
            id="new-password"
            label="Yeni şifre"
            autoComplete="new-password"
            hint={PASSWORD_RULE}
            value={password}
            onChange={setPassword}
            error={fieldError}
            extraDescribedBy={view.status === 'failure' ? STATUS_ID : null}
            inputRef={passwordRef}
          />
          <SubmitButton
            label="Şifremi güncelle"
            busyLabel="Güncelleniyor…"
            busy={view.status === 'pending'}
            hydrated
          />
        </form>
      ) : null}
    </>
  );
}
