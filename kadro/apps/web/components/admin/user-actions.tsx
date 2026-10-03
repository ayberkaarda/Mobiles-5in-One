'use client';

import { type PlatformRole, PLATFORM_ROLES } from '@kadro/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useRef, useState } from 'react';

import { normalizeTotpCode } from '../../lib/admin/client-api';
import styles from './admin.module.css';
import { MutationStatus, TotpField } from './fields';
import { roleLabel } from './labels';
import { useAdminMutation } from './use-admin-mutation';

type Pending =
  | { readonly kind: 'role'; readonly role: PlatformRole }
  | { readonly kind: 'deactivate'; readonly deactivated: boolean };

export function pendingSummary(displayName: string, pending: Pending): string {
  if (pending.kind === 'role') {
    return `${displayName} için rol "${roleLabel(pending.role)}" olacak.`;
  }
  return pending.deactivated
    ? `${displayName} engellenecek ve tüm oturumları kapanacak.`
    : `${displayName} için engel kaldırılacak.`;
}

/**
 * Role change and deactivation of one account (admin only, matrix §3.8 footnote 27). Each change
 * asks for a fresh code from the authenticator app, which the API verifies on top of the step-up
 * window (`PATCH admin/users/:id/role`, `PATCH admin/users/:id/deactivate`).
 */
export function UserActions({
  userId,
  displayName,
  role,
  deactivated,
  csrfCookieName,
}: {
  readonly userId: string;
  readonly displayName: string;
  readonly role: PlatformRole;
  readonly deactivated: boolean;
  readonly csrfCookieName: string;
}) {
  const router = useRouter();
  const { state, run, reset } = useAdminMutation(csrfCookieName);
  const [selectedRole, setSelectedRole] = useState<PlatformRole>(role);
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const roleId = `${baseId}-role`;
  const codeId = `${baseId}-code`;

  const start = (next: Pending) => {
    reset();
    setCode('');
    setCodeError(null);
    setPending(next);
  };

  const onConfirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending === null) {
      return;
    }
    const totpCode = normalizeTotpCode(code);
    if (totpCode === null) {
      setCodeError('6 haneli kodu yaz.');
      codeRef.current?.focus();
      return;
    }
    setCodeError(null);
    const mutation =
      pending.kind === 'role'
        ? ({ kind: 'setRole', id: userId, body: { role: pending.role, totpCode } } as const)
        : ({
            kind: 'setDeactivated',
            id: userId,
            body: { deactivated: pending.deactivated, totpCode },
          } as const);
    void run(mutation).then((outcome) => {
      setCode('');
      if (outcome?.kind === 'ok') {
        setPending(null);
        router.refresh();
      }
    });
  };

  if (pending !== null) {
    const busy = state.status === 'pending';
    return (
      <form className={styles.form} method="post" noValidate onSubmit={onConfirm}>
        <p className={styles.hint}>{pendingSummary(displayName, pending)}</p>
        <TotpField
          id={codeId}
          label="Onay kodu"
          value={code}
          onChange={setCode}
          error={codeError}
          inputRef={codeRef}
        />
        <MutationStatus
          id={`${baseId}-status`}
          state={state}
          pending="Kaydediliyor…"
          success="Kaydedildi."
        />
        <div className={styles.actions}>
          <button type="submit" className={styles.button} aria-disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Onayla'}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              setPending(null);
              reset();
            }}
          >
            Vazgeç
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={styles.actions}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={roleId}>
          Rol
        </label>
        <select
          id={roleId}
          className={styles.select}
          value={selectedRole}
          onChange={(event) => {
            const value = PLATFORM_ROLES.find((candidate) => candidate === event.target.value);
            if (value !== undefined) {
              setSelectedRole(value);
            }
          }}
        >
          {PLATFORM_ROLES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {roleLabel(candidate)}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className={styles.secondaryButton}
        aria-disabled={selectedRole === role}
        onClick={() => {
          if (selectedRole !== role) {
            start({ kind: 'role', role: selectedRole });
          }
        }}
      >
        Rolü değiştir
      </button>
      <button
        type="button"
        className={deactivated ? styles.secondaryButton : styles.dangerButton}
        onClick={() => {
          start({ kind: 'deactivate', deactivated: !deactivated });
        }}
      >
        {deactivated ? 'Engeli kaldır' : 'Engelle'}
      </button>
    </div>
  );
}
