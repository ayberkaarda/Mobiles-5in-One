'use client';

import Link from 'next/link';
import { type FormEvent, useReducer, useRef, useState } from 'react';

import { buildApiRequest } from '../../lib/client/api';
import { graceUntilFrom, readCookieValue } from '../../lib/client/cookies';
import { canSubmit, flowReducer, IDLE } from '../../lib/client/flow';
import { PAGE_COPY } from '../../lib/client/messages';
import { PAGE_PATHS } from '../../lib/client/redirects';
import styles from './auth.module.css';
import { PasswordField, StatusMessage, SubmitButton } from './fields';
import { sendFromPage, useFocusOn, useHydrated } from './hooks';

const STATUS_ID = 'delete-status';
const LOGIN_THEN_DELETE = `${PAGE_PATHS.login}?devam=${PAGE_PATHS.deleteAccount}` as const;

/**
 * Signed-in part of `/hesap-silme` (ADR-0032 §1): password re-authentication, an explicit
 * confirmation, then `DELETE /api/v1/me` with the CSRF double-submit header read from the CSRF
 * cookie, whose name the server page passes in.
 */
export function DeleteAccount({ csrfCookieName }: { readonly csrfCookieName: string }) {
  const hydrated = useHydrated();
  const [state, dispatch] = useReducer(flowReducer, IDLE);
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useFocusOn(statusRef, state.status === 'success' ? 'success' : null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit(state)) {
      return;
    }
    const passwordIssue = password === '' ? 'Şifreni yaz.' : null;
    const confirmIssue = confirmed ? null : 'Devam etmek için onay kutusunu işaretle.';
    setPasswordError(passwordIssue);
    setConfirmError(confirmIssue);
    if (passwordIssue !== null) {
      passwordRef.current?.focus();
      return;
    }
    if (confirmIssue !== null) {
      confirmRef.current?.focus();
      return;
    }
    const csrfToken = readCookieValue(document.cookie, csrfCookieName);
    dispatch({ type: 'submit' });
    if (csrfToken === null) {
      dispatch({
        type: 'settled',
        endpoint: 'deleteAccount',
        outcome: { kind: 'problem', status: 403, code: 'csrf_failed' },
      });
      return;
    }
    void sendFromPage(buildApiRequest('deleteAccount', { password }, csrfToken)).then((outcome) => {
      setPassword('');
      dispatch({ type: 'settled', outcome, endpoint: 'deleteAccount' });
    });
  };

  if (state.status === 'success') {
    const graceUntil = graceUntilFrom(state.body);
    return (
      <>
        <StatusMessage
          id={STATUS_ID}
          state={state}
          copy={PAGE_COPY.deleteAccount}
          statusRef={statusRef}
        />
        <p>
          {graceUntil === null
            ? 'Hesabın 7 gün sonra kalıcı olarak silinecek.'
            : `Hesabın ${graceUntil} tarihinde kalıcı olarak silinecek.`}{' '}
          Vazgeçersen bu tarihten önce giriş yapman yeterli.
        </p>
      </>
    );
  }

  const signedOut = state.status === 'failure' && state.failure === 'signed_out';
  return (
    <>
      <StatusMessage id={STATUS_ID} state={state} copy={PAGE_COPY.deleteAccount} />
      {signedOut ? (
        <div className={styles.actions}>
          <Link href={LOGIN_THEN_DELETE} className={styles.buttonLink}>
            Giriş yap
          </Link>
        </div>
      ) : (
        <form className={styles.form} method="post" noValidate onSubmit={onSubmit}>
          <PasswordField
            id="delete-password"
            label="Şifren"
            autoComplete="current-password"
            hint="Hesabının sana ait olduğunu doğrulamak için şifreni yaz."
            value={password}
            onChange={setPassword}
            error={passwordError}
            extraDescribedBy={state.status === 'failure' ? STATUS_ID : null}
            inputRef={passwordRef}
          />
          <div className={styles.field}>
            <div className={styles.checkboxRow}>
              <input
                ref={confirmRef}
                id="delete-confirm"
                name="delete-confirm"
                type="checkbox"
                className={styles.checkbox}
                checked={confirmed}
                aria-invalid={confirmError !== null}
                aria-describedby={confirmError === null ? undefined : 'delete-confirm-error'}
                onChange={(event) => {
                  setConfirmed(event.target.checked);
                }}
              />
              <label htmlFor="delete-confirm">
                7 gün içinde giriş yapmazsam hesabımın kalıcı olarak silineceğini anladım.
              </label>
            </div>
            {confirmError === null ? null : (
              <p id="delete-confirm-error" className={styles.fieldError}>
                {confirmError}
              </p>
            )}
          </div>
          <SubmitButton
            label="Hesabımı sil"
            busyLabel="Gönderiliyor…"
            busy={state.status === 'pending'}
            hydrated={hydrated}
            danger
          />
        </form>
      )}
    </>
  );
}

/** Shown on `/hesap-silme` when the request carries no web session cookie. */
export function DeleteAccountSignedOut() {
  return (
    <div className={styles.actions}>
      <p className={styles.section}>Hesabını silmek için önce giriş yap.</p>
      <Link href={LOGIN_THEN_DELETE} className={styles.buttonLink}>
        Giriş yap
      </Link>
    </div>
  );
}
