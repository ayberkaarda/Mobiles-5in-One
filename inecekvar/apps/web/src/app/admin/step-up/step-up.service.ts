import { inject, Injectable, signal } from '@angular/core';
import { AdminApi } from '../admin-api';
import { adminErrorMessage, hasCode, isSessionEnded, StepUpCancelled } from '../admin-errors';

export const TOTP_CODE_PATTERN = /^[0-9]{6}$/;

interface PendingVerification {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * The TOTP step-up of ADR-0037 seen from the UI: an action that answers 403
 * `auth.step_up_required` opens the code dialog; after a successful `POST auth/step-up` the
 * action runs exactly once more, and whatever that second attempt answers is final.
 */
@Injectable()
export class StepUpService {
  private readonly api = inject(AdminApi);
  private pending: PendingVerification | null = null;

  /** True while the code dialog is open. */
  readonly open = signal(false);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  /** When the current session's step-up stops counting (shown in the shell). */
  readonly verifiedUntil = signal<Date | null>(null);

  async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!hasCode(error, 'auth.step_up_required')) throw error;
    }
    await this.verify();
    return action();
  }

  /** Opens the dialog (or joins the one already open) and resolves after a valid code. */
  verify(): Promise<void> {
    if (this.pending !== null) return this.pending.promise;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    this.pending = { promise, resolve, reject };
    this.error.set(null);
    this.open.set(true);
    return promise;
  }

  async submit(code: string): Promise<void> {
    const pending = this.pending;
    if (pending === null || this.submitting()) return;
    if (!TOTP_CODE_PATTERN.test(code)) {
      this.error.set('Kod 6 rakamdan oluşur.');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      const result = await this.api.stepUp(code);
      this.verifiedUntil.set(new Date(result.expires_at));
      this.finish();
      pending.resolve();
    } catch (error) {
      if (hasCode(error, 'auth.totp_enrolment_required') || isSessionEnded(error)) {
        this.finish();
        pending.reject(error);
        return;
      }
      this.error.set(adminErrorMessage(error, 'totp'));
    } finally {
      this.submitting.set(false);
    }
  }

  cancel(): void {
    const pending = this.pending;
    if (pending === null || this.submitting()) return;
    this.finish();
    pending.reject(new StepUpCancelled());
  }

  /** Account switch or sign-out: forget the window and close any dialog. */
  reset(): void {
    const pending = this.pending;
    this.finish();
    this.verifiedUntil.set(null);
    this.submitting.set(false);
    pending?.reject(new StepUpCancelled());
  }

  private finish(): void {
    this.pending = null;
    this.open.set(false);
    this.error.set(null);
  }
}
