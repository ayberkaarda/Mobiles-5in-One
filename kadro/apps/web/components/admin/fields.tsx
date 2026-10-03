'use client';

import { type RefObject } from 'react';

import styles from './admin.module.css';
import { type MutationState } from './use-admin-mutation';

/** Six-digit code input of the authenticator app (one-time-code autofill, digits keyboard). */
export function TotpField({
  id,
  label,
  value,
  onChange,
  error,
  inputRef,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | null;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <p id={hintId} className={styles.hint}>
        Doğrulama uygulamandaki 6 haneli kod.
      </p>
      <input
        ref={inputRef}
        id={id}
        name={id}
        className={`${styles.input ?? ''} ${styles.code ?? ''}`.trim()}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        spellCheck={false}
        required
        aria-invalid={error !== null}
        aria-describedby={error === null ? hintId : `${hintId} ${errorId}`}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {error === null ? null : (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Polite live region for a form's result; empty while idle. */
export function MutationStatus({
  id,
  state,
  pending,
  success,
}: {
  readonly id: string;
  readonly state: MutationState;
  readonly pending: string;
  readonly success: string;
}) {
  let text = '';
  if (state.status === 'pending') {
    text = pending;
  } else if (state.status === 'success') {
    text = success;
  } else if (state.status === 'failure') {
    text = state.message;
  }
  return (
    <p
      id={id}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`${styles.status ?? ''} ${state.status === 'failure' ? (styles.error ?? '') : ''}`.trim()}
    >
      {text}
    </p>
  );
}
