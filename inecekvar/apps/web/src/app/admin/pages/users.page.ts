import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import {
  AdminApi,
  type AdminUser,
  type AdminUserPage,
  PAGE_SIZE,
  type Role,
  ROLES,
} from '../admin-api';
import { adminErrorMessage } from '../admin-errors';
import { formatTime, ROLE_LABELS } from '../admin-text';
import { ConfirmService } from '../dialogs/confirm.service';
import { StepUpService } from '../step-up/step-up.service';

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Users and roles (admin only; every call needs a fresh step-up, ADR-0037). */
@Component({
  selector: 'iv-admin-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Kullanıcılar ve roller</h1>
    <form class="iv-admin-card filters" (submit)="$event.preventDefault(); filter(role.value)">
      <label for="iv-users-role">Rol</label>
      <select id="iv-users-role" #role [disabled]="busy()">
        <option value="">Tümü</option>
        @for (item of roles; track item) {
          <option [value]="item">{{ label(item) }}</option>
        }
      </select>
      <div class="iv-admin-actions"><button type="submit" [disabled]="busy()">Listele</button></div>
    </form>
    @if (error(); as text) {
      <p class="iv-admin-error" role="alert" data-error="users">{{ text }}</p>
    }
    @if (message(); as text) {
      <p class="iv-admin-ok" role="status">{{ text }}</p>
    }
    @if (page(); as current) {
      <p class="iv-admin-muted">
        {{ current.total }} hesap · {{ current.offset + 1 }}–{{
          current.offset + current.items.length
        }}
      </p>
      <div class="scroll iv-admin-card">
        <table class="stack">
          <thead>
            <tr>
              <th scope="col">Hesap</th>
              <th scope="col">Rol</th>
              <th scope="col">TOTP</th>
              <th scope="col">Kayıt</th>
              <th scope="col">Yeni rol</th>
            </tr>
          </thead>
          <tbody>
            @for (user of current.items; track user.id) {
              <tr [attr.data-user]="user.email">
                <td class="text" data-label="Hesap">
                  <div>
                    {{ user.display_name || '—' }}<br /><span class="iv-admin-muted">{{
                      user.email
                    }}</span>
                  </div>
                </td>
                <td data-label="Rol">
                  {{ label(user.role) }}{{ user.deactivated_at ? ' (kapalı)' : '' }}
                </td>
                <td data-label="TOTP">{{ user.totp_enabled ? 'Açık' : 'Kapalı' }}</td>
                <td data-label="Kayıt">{{ time(user.created_at) }}</td>
                <td data-label="Yeni rol">
                  <div>
                    <label class="sr" [attr.for]="'iv-role-' + user.id"
                      >Yeni rol: {{ user.email }}</label
                    >
                    <select
                      [id]="'iv-role-' + user.id"
                      #next
                      [disabled]="busy() || !!user.deactivated_at"
                    >
                      @for (item of roles; track item) {
                        <option [value]="item" [selected]="item === user.role">
                          {{ label(item) }}
                        </option>
                      }
                    </select>
                    <button
                      type="button"
                      class="secondary"
                      [disabled]="busy() || !!user.deactivated_at"
                      (click)="change(user, next)"
                    >
                      Kaydet
                    </button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="iv-admin-actions">
        <button
          type="button"
          class="secondary"
          [disabled]="busy() || current.offset === 0"
          (click)="go(current.offset - pageSize)"
        >
          Önceki
        </button>
        <button
          type="button"
          class="secondary"
          [disabled]="busy() || current.offset + current.items.length >= current.total"
          (click)="go(current.offset + pageSize)"
        >
          Sonraki
        </button>
      </div>
    }
  `,
  styles: `
    .filters {
      max-width: 24rem;
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
    td select {
      margin-bottom: 0.25rem;
    }
  `,
})
export class UsersPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly stepUp = inject(StepUpService);
  private readonly confirm = inject(ConfirmService);
  protected readonly roles = ROLES;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly page = signal<AdminUserPage | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  private roleFilter: Role | null = null;

  ngOnInit(): Promise<void> {
    return this.go(0);
  }

  protected label(role: string): string {
    return ROLE_LABELS[role] ?? role;
  }

  protected time(iso: string): string {
    return formatTime(iso);
  }

  filter(value: string): Promise<void> {
    this.roleFilter = isRole(value) ? value : null;
    return this.go(0);
  }

  async go(offset: number): Promise<void> {
    await this.task(async () => {
      this.page.set(
        await this.stepUp.run(() => this.api.users(Math.max(0, offset), this.roleFilter)),
      );
    });
  }

  /** The select shows the stored role again whenever the change does not go through. */
  async change(user: AdminUser, select: HTMLSelectElement): Promise<void> {
    const value = select.value;
    if (!isRole(value) || value === user.role || this.busy()) return;
    const ok = await this.confirm.ask({
      title: 'Rol değiştirilsin mi?',
      body: `${user.email}: ${this.label(user.role)} → ${this.label(value)}. Değişiklik denetim kaydına yazılır; yetkisi düşen hesabın doğrulaması sıfırlanır.`,
      confirmLabel: 'Rolü değiştir',
    });
    if (!ok) {
      select.value = user.role;
      return;
    }
    const done = await this.task(async () => {
      const updated = await this.stepUp.run(() => this.api.changeRole(user.id, value));
      this.page.update((page) =>
        page
          ? { ...page, items: page.items.map((item) => (item.id === updated.id ? updated : item)) }
          : page,
      );
      this.message.set(`${updated.email} artık ${this.label(updated.role)}.`);
    }, 'role');
    if (!done) select.value = user.role;
  }

  private async task(
    run: () => Promise<void>,
    context: 'generic' | 'role' = 'generic',
  ): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      await run();
      return true;
    } catch (error) {
      this.error.set(adminErrorMessage(error, context));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
