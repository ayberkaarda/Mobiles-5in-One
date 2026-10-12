import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiError } from '@inecekvar/data-access';
import { AdminApi } from '../admin-api';
import { AccountChanged, StepUpCancelled } from '../admin-errors';
import { AdminSession } from '../admin-session';
import { StepUpService } from './step-up.service';

const problem = (status: number, code: string) => new ApiError('problem', status, code, 'req-1');
const stepUpRequired = () => problem(403, 'auth.step_up_required');

function setup(
  stepUp = vi.fn(async () => ({ verified_at: 'x', expires_at: '2026-10-12T12:15:00Z' })),
) {
  const user = signal<{ id: string } | null>({ id: 'user-a' });
  const session = {
    user,
    /** By default the account stays the same; a test can switch it from "another tab". */
    recheck: vi.fn(async () => true),
  };
  TestBed.configureTestingModule({
    providers: [
      StepUpService,
      { provide: AdminApi, useValue: { stepUp } },
      { provide: AdminSession, useValue: session },
    ],
  });
  return { service: TestBed.inject(StepUpService), stepUp, session, user };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => TestBed.resetTestingModule());

describe('StepUpService', () => {
  it('runs an action that needs no step-up without a dialog', async () => {
    const { service, stepUp } = setup();
    const action = vi.fn(async () => 'done');
    await expect(service.run(action)).resolves.toBe('done');
    expect(action).toHaveBeenCalledTimes(1);
    expect(service.open()).toBe(false);
    expect(stepUp).not.toHaveBeenCalled();
  });

  it('asks for a code after auth.step_up_required and retries the action once', async () => {
    const { service, stepUp } = setup();
    const action = vi
      .fn()
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValueOnce('rolled back');
    const result = service.run(action);
    await flush();
    expect(service.open()).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    await service.submit('123456');
    await expect(result).resolves.toBe('rolled back');
    expect(stepUp).toHaveBeenCalledExactlyOnceWith('123456');
    expect(action).toHaveBeenCalledTimes(2);
    expect(service.open()).toBe(false);
    expect(service.verifiedUntil()?.toISOString()).toBe('2026-10-12T12:15:00.000Z');
  });

  it('retries only once: a second auth.step_up_required is final and opens no new dialog', async () => {
    const { service } = setup();
    const action = vi.fn().mockRejectedValue(stepUpRequired());
    const result = service.run(action);
    await flush();
    await service.submit('123456');
    await expect(result).rejects.toMatchObject({ code: 'auth.step_up_required' });
    expect(action).toHaveBeenCalledTimes(2);
    expect(service.open()).toBe(false);
  });

  it('passes other refusals through without a dialog', async () => {
    const { service } = setup();
    const action = vi.fn().mockRejectedValue(problem(403, 'auth.forbidden'));
    await expect(service.run(action)).rejects.toMatchObject({ code: 'auth.forbidden' });
    expect(service.open()).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open after a wrong code and succeeds with the next one', async () => {
    const stepUp = vi
      .fn()
      .mockRejectedValueOnce(problem(403, 'auth.totp_invalid_code'))
      .mockResolvedValueOnce({ verified_at: 'x', expires_at: '2026-10-12T12:15:00Z' });
    const { service } = setup(stepUp);
    const action = vi.fn().mockRejectedValueOnce(stepUpRequired()).mockResolvedValueOnce('ok');
    const result = service.run(action);
    await flush();
    await service.submit('000000');
    expect(service.open()).toBe(true);
    expect(service.error()).toContain('Kod geçersiz');
    await service.submit('111111');
    await expect(result).resolves.toBe('ok');
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('refuses a malformed code before calling the API', async () => {
    const { service, stepUp } = setup();
    void service.verify();
    await service.submit('12ab56');
    expect(stepUp).not.toHaveBeenCalled();
    expect(service.error()).toBe('Kod 6 rakamdan oluşur.');
  });

  it('cancelling rejects with StepUpCancelled and does not retry', async () => {
    const { service } = setup();
    const action = vi.fn().mockRejectedValue(stepUpRequired());
    const result = service.run(action);
    await flush();
    service.cancel();
    await expect(result).rejects.toBeInstanceOf(StepUpCancelled);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('ends the flow when TOTP is not enrolled', async () => {
    const { service } = setup(
      vi.fn().mockRejectedValue(problem(403, 'auth.totp_enrolment_required')),
    );
    const action = vi.fn().mockRejectedValue(stepUpRequired());
    const result = service.run(action);
    await flush();
    await service.submit('123456');
    await expect(result).rejects.toMatchObject({ code: 'auth.totp_enrolment_required' });
    expect(service.open()).toBe(false);
  });

  it('two actions waiting for a step-up share one dialog', async () => {
    const { service, stepUp } = setup();
    const first = vi.fn().mockRejectedValueOnce(stepUpRequired()).mockResolvedValueOnce(1);
    const second = vi.fn().mockRejectedValueOnce(stepUpRequired()).mockResolvedValueOnce(2);
    const results = Promise.all([service.run(first), service.run(second)]);
    await flush();
    await service.submit('123456');
    await expect(results).resolves.toEqual([1, 2]);
    expect(stepUp).toHaveBeenCalledTimes(1);
  });

  it('re-checks the account after a valid code and aborts the retry when another tab switched it', async () => {
    const { service, session, user } = setup();
    session.recheck.mockImplementation(async () => {
      user.set({ id: 'user-b' });
      return false;
    });
    const action = vi.fn().mockRejectedValueOnce(stepUpRequired()).mockResolvedValueOnce('ran');
    const result = service.run(action);
    await flush();
    service.verifiedUntil.set(new Date());
    await service.submit('123456');
    await expect(result).rejects.toBeInstanceOf(AccountChanged);
    expect(session.recheck).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(service.open()).toBe(false);
    expect(service.verifiedUntil()).toBeNull();
  });

  it('aborts the retry when the user id differs from the one that opened the dialog', async () => {
    const { service, session, user } = setup();
    session.recheck.mockImplementation(async () => {
      user.set({ id: 'user-b' });
      return true;
    });
    const action = vi.fn().mockRejectedValueOnce(stepUpRequired()).mockResolvedValueOnce('ran');
    const result = service.run(action);
    await flush();
    await service.submit('123456');
    await expect(result).rejects.toBeInstanceOf(AccountChanged);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('re-checks the account before the retry when it is unchanged', async () => {
    const { service, session } = setup();
    const action = vi.fn().mockRejectedValueOnce(stepUpRequired()).mockResolvedValueOnce('ran');
    const result = service.run(action);
    await flush();
    expect(session.recheck).not.toHaveBeenCalled();
    await service.submit('123456');
    await expect(result).resolves.toBe('ran');
    expect(session.recheck).toHaveBeenCalledTimes(1);
  });

  it('reset closes the dialog and forgets the window', async () => {
    const { service } = setup();
    const result = service.run(vi.fn().mockRejectedValue(stepUpRequired()));
    await flush();
    service.verifiedUntil.set(new Date());
    service.reset();
    await expect(result).rejects.toBeInstanceOf(StepUpCancelled);
    expect(service.open()).toBe(false);
    expect(service.verifiedUntil()).toBeNull();
  });
});
