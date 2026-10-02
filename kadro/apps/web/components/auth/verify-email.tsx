'use client';

import Link from 'next/link';
import { useEffect, useReducer, useRef } from 'react';

import { buildApiRequest } from '../../lib/client/api';
import {
  canSubmit,
  failureFor,
  type FlowEvent,
  type FlowState,
  flowReducer,
  PENDING,
} from '../../lib/client/flow';
import { PAGE_COPY } from '../../lib/client/messages';
import { PAGE_PATHS } from '../../lib/client/redirects';
import { type CaptureSnapshot, pageTokenCapture } from '../../lib/client/token-capture';
import styles from './auth.module.css';
import { StatusMessage } from './fields';
import { sendFromPage, useCapturedToken, useFocusOn } from './hooks';

const LINK_INVALID: FlowState = {
  status: 'failure',
  failure: 'link_invalid',
  retryAfterSeconds: null,
};

async function redeem(captured: CaptureSnapshot, token: string): Promise<FlowEvent> {
  const outcome = await sendFromPage(buildApiRequest('verifyEmail', { token }), captured.signal);
  const failure = failureFor('verifyEmail', outcome);
  if (failure === null || failure === 'link_invalid') {
    // ADR-0040 step 5: the token is spent or useless; drop it from memory.
    pageTokenCapture.forget(captured.version);
  }
  return { type: 'settled', outcome, endpoint: 'verifyEmail' };
}

/**
 * `/e-posta-dogrula#token=…` (ADR-0040): posts the captured token once, automatically. A missing
 * or malformed token shows the invalid-link state without calling the API. A new link opened in
 * the same document is redeemed once in turn; a return from the back/forward cache asks for the
 * link again.
 */
export function VerifyEmail() {
  const captured = useCapturedToken(PAGE_PATHS.verifyEmail);
  return <VerifyEmailStatus key={captured?.version ?? 'server'} captured={captured} />;
}

function VerifyEmailStatus({ captured }: { readonly captured: CaptureSnapshot | null }) {
  const [state, dispatch] = useReducer(flowReducer, PENDING);
  const started = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const view: FlowState =
    state.status !== 'success' && captured !== null && captured.token.kind !== 'valid'
      ? LINK_INVALID
      : state;

  useEffect(() => {
    if (captured?.token.kind !== 'valid' || started.current) {
      return;
    }
    started.current = true;
    const { signal } = captured;
    void redeem(captured, captured.token.token).then((event) => {
      if (!signal.aborted) {
        dispatch(event);
      }
    });
  }, [captured]);

  useFocusOn(
    statusRef,
    view.status === 'success' || view.status === 'failure' ? view.status : null,
  );

  const retry = () => {
    if (captured?.token.kind === 'valid' && canSubmit(state)) {
      const { signal } = captured;
      dispatch({ type: 'submit' });
      void redeem(captured, captured.token.token).then((event) => {
        if (!signal.aborted) {
          dispatch(event);
        }
      });
    }
  };

  return (
    <>
      <StatusMessage
        id="verify-status"
        state={view}
        copy={PAGE_COPY.verifyEmail}
        statusRef={statusRef}
      />
      {view.status === 'success' ? (
        <div className={styles.actions}>
          <Link href={PAGE_PATHS.login} className={styles.buttonLink}>
            Giriş yap
          </Link>
        </div>
      ) : null}
      {view.status === 'failure' && view.failure === 'link_invalid' ? (
        <div className={styles.actions}>
          <p className={styles.hint}>
            Yeni bir doğrulama e-postasını giriş yaptıktan sonra uygulamadan isteyebilirsin.
          </p>
          <Link href={PAGE_PATHS.login} className={styles.buttonLink}>
            Giriş yap
          </Link>
          <Link href={PAGE_PATHS.forgot} className={styles.link}>
            Şifremi unuttum
          </Link>
        </div>
      ) : null}
      {view.status === 'failure' && view.failure !== 'link_invalid' ? (
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={retry}>
            Tekrar dene
          </button>
        </div>
      ) : null}
    </>
  );
}
