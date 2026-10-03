'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { type AdminMutation, adminFailure, sendAdminMutation } from '../../lib/admin/client-api';
import { type ApiOutcome } from '../../lib/client/api';
import { ADMIN_PATHS } from './paths';

export type MutationState =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'success'; readonly body: unknown }
  | { readonly status: 'failure'; readonly message: string };

/**
 * One admin request at a time from a form. A failure that ends the session or the step-up window
 * sends the user to the matching page after the message is shown; every other failure stays on
 * the form.
 */
export function useAdminMutation(csrfCookieName: string) {
  const router = useRouter();
  const [state, setState] = useState<MutationState>({ status: 'idle' });
  const busy = useRef(false);

  const run = useCallback(
    async (mutation: AdminMutation): Promise<ApiOutcome | null> => {
      if (busy.current) {
        return null;
      }
      busy.current = true;
      setState({ status: 'pending' });
      try {
        const outcome = await sendAdminMutation(mutation, csrfCookieName);
        const failure = adminFailure(mutation.kind, outcome);
        if (failure === null) {
          setState({ status: 'success', body: outcome.kind === 'ok' ? outcome.body : null });
        } else {
          setState({ status: 'failure', message: failure.message });
          if (failure.action === 'sign_in') {
            router.push(ADMIN_PATHS.signIn);
          } else if (failure.action === 'step_up') {
            router.push(ADMIN_PATHS.stepUp);
          }
        }
        return outcome;
      } finally {
        busy.current = false;
      }
    },
    [csrfCookieName, router],
  );

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return { state, run, reset };
}
