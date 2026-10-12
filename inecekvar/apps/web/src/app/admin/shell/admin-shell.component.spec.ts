import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminSession } from '../admin-session';
import { AdminDialogsComponent } from '../dialogs/dialogs.component';
import { ConfirmService } from '../dialogs/confirm.service';
import { StepUpService } from '../step-up/step-up.service';
import { AdminShellComponent } from './admin-shell.component';

function setup() {
  const session = {
    user: signal({ id: 'user-a', email: 'a@example.com', role: 'moderator' }),
    status: signal('signed-in'),
    generation: signal(1),
    notice: signal(null),
    totp: signal(null),
    isAdmin: signal(false),
    track: vi.fn(),
    refreshTotp: vi.fn(async () => undefined),
    recheck: vi.fn(async () => true),
  };
  TestBed.configureTestingModule({
    imports: [AdminShellComponent],
    providers: [
      provideRouter([]),
      { provide: AdminSession, useValue: session },
      { provide: StepUpService, useValue: { reset: vi.fn(), verifiedUntil: signal(null) } },
      { provide: ConfirmService, useValue: { answer: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(AdminShellComponent, {
    remove: { imports: [AdminDialogsComponent] },
    add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(AdminShellComponent);
  fixture.detectChanges();
  return { fixture, session };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('AdminShellComponent account re-check', () => {
  it('re-checks GET me when the window regains focus', () => {
    const { session } = setup();
    window.dispatchEvent(new Event('focus'));
    expect(session.recheck).toHaveBeenCalledTimes(1);
  });

  it('re-checks GET me when the tab becomes visible, not when it is hidden', () => {
    const { session } = setup();
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(session.recheck).not.toHaveBeenCalled();
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(session.recheck).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the shell is destroyed', () => {
    const { fixture, session } = setup();
    fixture.destroy();
    window.dispatchEvent(new Event('focus'));
    expect(session.recheck).not.toHaveBeenCalled();
  });
});
