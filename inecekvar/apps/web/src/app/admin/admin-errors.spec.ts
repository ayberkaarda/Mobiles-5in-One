import { ApiError } from '@inecekvar/data-access';
import { adminErrorMessage, StepUpCancelled } from './admin-errors';

const problem = (status: number, code: string, retryAfter: number | null = null) =>
  new ApiError(
    status === 429 ? 'rate_limited' : 'problem',
    status,
    code,
    'req-1',
    null,
    retryAfter,
  );

describe('adminErrorMessage', () => {
  it('maps a 403 auth.forbidden to the self-approval copy on the approve button', () => {
    expect(adminErrorMessage(problem(403, 'auth.forbidden'), 'approve')).toContain(
      'kendi önerini onaylayamazsın',
    );
  });

  it('maps a generic 403 to a role message and never to a session message', () => {
    const text = adminErrorMessage(problem(403, 'auth.forbidden'));
    expect(text).toContain('yetkin yok');
    expect(text).not.toContain('Oturum');
  });

  it('names the step-up and enrolment codes', () => {
    expect(adminErrorMessage(problem(403, 'auth.step_up_required'))).toContain('doğrulama kodu');
    expect(adminErrorMessage(problem(403, 'auth.totp_enrolment_required'))).toContain('TOTP');
  });

  it('explains the last-admin refusal', () => {
    expect(adminErrorMessage(problem(409, 'admin.last_admin'), 'role')).toBe(
      'Son yönetici rolünü bırakamaz. Önce başka bir hesabı yönetici yap, sonra yeniden dene.',
    );
  });

  it('treats any 401 as an ended session, except a wrong password on sign-in', () => {
    expect(adminErrorMessage(problem(401, 'auth.required'))).toContain('Oturumun sona erdi');
    expect(adminErrorMessage(problem(401, 'auth.invalid_credentials'), 'sign-in')).toBe(
      'E-posta ya da şifre yanlış.',
    );
  });

  it('turns Retry-After into minutes', () => {
    expect(adminErrorMessage(problem(429, 'rate_limited', 600))).toContain('10 dakika');
    expect(adminErrorMessage(problem(429, 'rate_limited'))).toContain('Biraz bekleyip');
  });

  it('never echoes a server detail or an unknown code', () => {
    const error = new ApiError('problem', 418, 'x.<script>', 'req-1', '<b>detail</b>');
    const text = adminErrorMessage(error);
    expect(text).not.toContain('<');
    expect(text).not.toContain('x.');
  });

  it('covers cancellation and non-API failures', () => {
    expect(adminErrorMessage(new StepUpCancelled())).toContain('iptal');
    expect(adminErrorMessage(new Error('boom'))).toContain('Beklenmeyen');
  });
});
