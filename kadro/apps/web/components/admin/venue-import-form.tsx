'use client';

import { LIMITS, venueImportSchema } from '@kadro/contracts';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

import { useHydrated } from '../auth/hooks';
import styles from './admin.module.css';
import { MutationStatus } from './fields';
import { importStatusPath } from './paths';
import { useAdminMutation } from './use-admin-mutation';

const FILE_ID = 'import-file';
const FILE_ERROR_ID = `${FILE_ID}-error`;

/** Problem with the chosen file before anything is sent, or `null`. */
export function csvFileProblem(
  file: { readonly name: string; readonly size: number } | null,
): string | null {
  if (file === null) {
    return 'Bir CSV dosyası seç.';
  }
  if (!/\.csv$/i.test(file.name)) {
    return 'Dosya .csv uzantılı olmalı.';
  }
  if (file.size === 0) {
    return 'Dosya boş.';
  }
  // UTF-8 text is never shorter in bytes than in characters; this keeps the JSON body under 1 MiB.
  if (file.size > LIMITS.venueImportCsv.maxChars) {
    return 'Dosya çok büyük. En fazla 900 000 karakter yükleyebilirsin.';
  }
  return null;
}

/**
 * Starts a venue import (`POST admin/venues/import`, admin only, ADR-0064 §6): the CSV is read in
 * the browser and sent inline; the answer (202) leads to the import's status page. Dry run is on
 * by default, so a first upload only validates.
 */
export function VenueImportForm({ csrfCookieName }: { readonly csrfCookieName: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const { state, run } = useAdminMutation(csrfCookieName);
  const [dryRun, setDryRun] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0] ?? null;
    const problem = csvFileProblem(file);
    setFileError(problem);
    if (problem !== null || file === null) {
      fileRef.current?.focus();
      return;
    }
    void file.text().then(async (csv) => {
      const outcome = await run({ kind: 'importVenues', body: { csv, dryRun } });
      if (outcome?.kind !== 'ok') {
        return;
      }
      const parsed = venueImportSchema.safeParse(outcome.body);
      const target = parsed.success ? importStatusPath(parsed.data.id) : null;
      if (target !== null) {
        router.push(target);
      }
    });
  };

  const busy = state.status === 'pending' || state.status === 'success';
  return (
    <>
      <MutationStatus
        id="import-status"
        state={state}
        pending="Dosya gönderiliyor…"
        success="İçe aktarma sıraya alındı. Durum sayfasına geçiliyor…"
      />
      <form className={styles.form} method="post" noValidate onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={FILE_ID}>
            CSV dosyası
          </label>
          <input
            ref={fileRef}
            id={FILE_ID}
            name={FILE_ID}
            className={styles.input}
            type="file"
            accept=".csv,text/csv"
            required
            aria-invalid={fileError !== null}
            aria-describedby={fileError === null ? undefined : FILE_ERROR_ID}
            onChange={() => {
              setFileError(null);
            }}
          />
          {fileError === null ? null : (
            <p id={FILE_ERROR_ID} className={styles.error}>
              {fileError}
            </p>
          )}
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            name="dry-run"
            checked={dryRun}
            onChange={(event) => {
              setDryRun(event.target.checked);
            }}
          />
          Deneme çalıştırması (yalnızca doğrula, kaydetme)
        </label>
        <button type="submit" className={styles.button} disabled={!hydrated} aria-disabled={busy}>
          {busy ? 'Gönderiliyor…' : dryRun ? 'Dosyayı doğrula' : 'İçe aktarmayı başlat'}
        </button>
      </form>
    </>
  );
}
