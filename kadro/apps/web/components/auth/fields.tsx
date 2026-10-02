'use client';

import { type RefObject, useState } from 'react';

import { describedBy } from '../../lib/client/a11y';
import { announcement, type PageCopy } from '../../lib/client/messages';
import { type FlowState } from '../../lib/client/flow';
import styles from './auth.module.css';

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  readonly error?: string | null;
  /** Ids of further describing elements, e.g. the page status when it reports a failure. */
  readonly extraDescribedBy?: string | null;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
}

export function EmailField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  extraDescribedBy,
  inputRef,
  autoComplete,
}: FieldProps & { readonly autoComplete: 'email' | 'username' }) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error !== null;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      <input
        ref={inputRef}
        id={id}
        name={id}
        className={styles.input}
        type="email"
        inputMode="email"
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        required
        aria-invalid={hasError}
        aria-describedby={describedBy(
          hint !== undefined && hintId,
          hasError && errorId,
          extraDescribedBy,
        )}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hasError ? (
        <p id={errorId} className={styles.fieldError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Password input with a show/hide toggle that is a real button (ADR-0040). */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  extraDescribedBy,
  inputRef,
  autoComplete,
}: FieldProps & { readonly autoComplete: 'new-password' | 'current-password' }) {
  const [visible, setVisible] = useState(false);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error !== null;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      <div className={styles.passwordRow}>
        <input
          ref={inputRef}
          id={id}
          name={id}
          className={styles.input}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          aria-invalid={hasError}
          aria-describedby={describedBy(
            hint !== undefined && hintId,
            hasError && errorId,
            extraDescribedBy,
          )}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-controls={id}
          aria-pressed={visible}
          onClick={() => {
            setVisible((current) => !current);
          }}
        >
          <span className={styles.visuallyHidden}>Şifreyi </span>
          {visible ? 'gizle' : 'göster'}
        </button>
      </div>
      {hasError ? (
        <p id={errorId} className={styles.fieldError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Polite live region for the page status (ADR-0040): always in the DOM so screen readers pick up
 * changes; empty while idle. `tabIndex={-1}` lets the page move focus here after a result.
 */
export function StatusMessage({
  id,
  state,
  copy,
  statusRef,
}: {
  readonly id: string;
  readonly state: FlowState;
  readonly copy: PageCopy;
  readonly statusRef?: RefObject<HTMLParagraphElement | null>;
}) {
  const failed = state.status === 'failure';
  return (
    <p
      id={id}
      ref={statusRef}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`${styles.status ?? ''} ${failed ? (styles.statusError ?? '') : ''} ${styles.focusTarget ?? ''}`.trim()}
    >
      {announcement(state, copy)}
    </p>
  );
}

export function SubmitButton({
  label,
  busyLabel,
  busy,
  hydrated,
  danger = false,
}: {
  readonly label: string;
  readonly busyLabel: string;
  readonly busy: boolean;
  readonly hydrated: boolean;
  readonly danger?: boolean;
}) {
  return (
    <button
      type="submit"
      className={`${styles.button ?? ''} ${danger ? (styles.dangerButton ?? '') : ''}`.trim()}
      // Stays focusable while a request runs (focus is not lost); the flow ignores repeat submits.
      disabled={!hydrated}
      aria-disabled={busy}
    >
      {busy ? busyLabel : label}
    </button>
  );
}
