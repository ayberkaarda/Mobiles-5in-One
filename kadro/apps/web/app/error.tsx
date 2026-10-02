'use client';

/**
 * Route-segment error boundary (security checklist item 13). It renders a fixed message and the
 * opaque error digest that correlates with server logs; the error message, stack and any other
 * detail are never shown.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
}) {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '96px 24px' }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>Bir şeyler ters gitti</h1>
      <p style={{ fontSize: 17, lineHeight: 1.6, color: '#5B6B62' }}>
        Beklenmeyen bir hata oluştu. Lütfen biraz sonra tekrar dene.
      </p>
      {error.digest === undefined ? null : (
        <p style={{ fontSize: 13, color: '#5B6B62' }}>Referans: {error.digest}</p>
      )}
      <button type="button" onClick={() => retry()}>
        Tekrar dene
      </button>
    </main>
  );
}
