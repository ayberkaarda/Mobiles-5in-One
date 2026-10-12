import { TestBed } from '@angular/core/testing';
import { ApiError } from '@inecekvar/data-access';
import { AdminApi, type AdminUser, type AdminUserPage } from '../admin-api';
import { ConfirmService } from '../dialogs/confirm.service';
import { StepUpService } from '../step-up/step-up.service';
import { UsersPage } from './users.page';

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'a1',
    email: 'yonetici@example.com',
    display_name: 'Yönetici <b>bir</b>',
    role: 'admin',
    created_at: '2026-10-01T08:00:00Z',
    email_verified_at: '2026-10-01T08:00:00Z',
    totp_enabled: true,
    deactivated_at: null,
    ...overrides,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const page = (items: AdminUser[]): AdminUserPage => ({
  items,
  total: items.length,
  limit: 25,
  offset: 0,
});

async function render(api: Partial<Record<keyof AdminApi, unknown>>) {
  TestBed.configureTestingModule({
    providers: [
      { provide: AdminApi, useValue: api },
      { provide: StepUpService, useValue: { run: <T>(action: () => Promise<T>) => action() } },
      { provide: ConfirmService, useValue: { ask: vi.fn(async () => true) } },
    ],
  });
  const fixture = TestBed.createComponent(UsersPage);
  fixture.detectChanges();
  await settle();
  fixture.detectChanges();
  return fixture;
}

afterEach(() => TestBed.resetTestingModule());

describe('UsersPage', () => {
  it('shows the API 403 instead of hiding it behind the UI role check', async () => {
    const fixture = await render({
      users: vi.fn().mockRejectedValue(new ApiError('problem', 403, 'auth.forbidden', 'r')),
    });
    const error = fixture.nativeElement.querySelector('[data-error="users"]') as HTMLElement;
    expect(error.textContent).toContain('yetkin yok');
  });

  it('explains the last-admin refusal of a role change', async () => {
    const changeRole = vi
      .fn()
      .mockRejectedValue(new ApiError('problem', 409, 'admin.last_admin', 'r'));
    const fixture = await render({ users: vi.fn(async () => page([user()])), changeRole });
    const select = fixture.nativeElement.querySelector('#iv-role-a1') as HTMLSelectElement;
    select.value = 'moderator';
    (select.nextElementSibling as HTMLButtonElement).click();
    await settle();
    fixture.detectChanges();
    expect(changeRole).toHaveBeenCalledExactlyOnceWith('a1', 'moderator');
    expect(fixture.nativeElement.querySelector('[data-error="users"]').textContent).toContain(
      'Son yönetici rolünü bırakamaz',
    );
    expect(select.value).toBe('admin');
  });

  it('renders account names as text', async () => {
    const fixture = await render({ users: vi.fn(async () => page([user()])) });
    const cell = fixture.nativeElement.querySelector(
      '[data-user="yonetici@example.com"] td',
    ) as HTMLElement;
    expect(cell.textContent).toContain('Yönetici <b>bir</b>');
    expect(cell.querySelector('b')).toBeNull();
  });

  it('does not call the API when the role is unchanged', async () => {
    const changeRole = vi.fn();
    const fixture = await render({ users: vi.fn(async () => page([user()])), changeRole });
    (fixture.nativeElement.querySelector('#iv-role-a1 + button') as HTMLButtonElement).click();
    await settle();
    expect(changeRole).not.toHaveBeenCalled();
  });
});
