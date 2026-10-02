'use client';

/**
 * Root error boundary, used when the root layout itself fails (security checklist item 13).
 * It renders its own document with a fixed message and the opaque digest only.
 */
export default function GlobalError({
  error,
  retry,
}: {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
}) {
  return (
    <html lang="tr">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ maxWidth: 640, margin: '0 auto', padding: '96px 24px' }}>
          <title>Kadro: hata</title>
          <h1 style={{ fontSize: 28, margin: 0 }}>Bir şeyler ters gitti</h1>
          <p style={{ fontSize: 17, lineHeight: 1.6 }}>
            Beklenmeyen bir hata oluştu. Lütfen biraz sonra tekrar dene.
          </p>
          {error.digest === undefined ? null : (
            <p style={{ fontSize: 13 }}>Referans: {error.digest}</p>
          )}
          <button type="button" onClick={() => retry()}>
            Tekrar dene
          </button>
        </main>
      </body>
    </html>
  );
}
