import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { formatFare } from '../../content/format';
import {
  AdminApi,
  type CitySummary,
  type LineDetail,
  type LineSummary,
  type VersionSummary,
} from '../admin-api';
import { adminErrorMessage } from '../admin-errors';
import { formatTime } from '../admin-text';
import { ConfirmService } from '../dialogs/confirm.service';
import { StepUpService } from '../step-up/step-up.service';

export const LINE_QUERY_MAX = 80;

/** Rollback to any earlier version (ADR-0021): a new version copies the chosen one. */
@Component({
  selector: 'iv-admin-versions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Sürümler ve geri alma</h1>
    <section class="iv-admin-card">
      <form class="grid" (submit)="$event.preventDefault(); search(city.value, query.value)">
        <div>
          <label for="iv-versions-city">Şehir</label>
          <select id="iv-versions-city" #city [disabled]="busy()">
            @for (item of cities(); track item.slug) {
              <option [value]="item.slug">{{ item.name }}</option>
            }
          </select>
        </div>
        <div>
          <label for="iv-versions-q">Hat kodu ya da adı</label>
          <input id="iv-versions-q" #query [attr.maxlength]="queryMax" [disabled]="busy()" />
        </div>
        <div class="iv-admin-actions"><button type="submit" [disabled]="busy()">Ara</button></div>
      </form>
      @if (lines().length > 0) {
        <ul class="lines">
          @for (line of lines(); track line.id) {
            <li>
              <button type="button" class="secondary" (click)="open(line)" [disabled]="busy()">
                {{ line.code }} · {{ line.name }}
              </button>
            </li>
          }
        </ul>
      } @else if (searched()) {
        <p class="iv-admin-muted">Hat bulunamadı.</p>
      }
    </section>
    @if (line(); as current) {
      <section class="iv-admin-card" data-line>
        <h2>{{ current.code }} · {{ current.name }}</h2>
        <p class="iv-admin-muted">
          Yayındaki sürüm: {{ current.version_no }} · Durum:
          {{ current.status === 'retired' ? 'kaldırıldı' : 'yayında' }}
        </p>
        <div class="scroll">
          <table class="stack">
            <thead>
              <tr>
                <th scope="col">Sürüm</th>
                <th scope="col">Yayın</th>
                <th scope="col">Ücret</th>
                <th scope="col">Durak</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (version of versions(); track version.version_no) {
                <tr [attr.data-version]="version.version_no">
                  <td data-label="Sürüm">{{ version.version_no }}</td>
                  <td data-label="Yayın">{{ time(version.published_at) }}</td>
                  <td data-label="Ücret">{{ fare(version.fare_minor) }}</td>
                  <td data-label="Durak">{{ version.stop_count }}</td>
                  <td data-label="İşlem">
                    @if (version.version_no !== current.version_no) {
                      <button
                        type="button"
                        class="secondary"
                        (click)="rollback(current, version)"
                        [disabled]="busy()"
                      >
                        Bu sürüme dön
                      </button>
                    } @else {
                      <span class="iv-admin-muted">yayında</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
    @if (message(); as text) {
      <p class="iv-admin-ok" role="status">{{ text }}</p>
    }
    @if (error(); as text) {
      <p class="iv-admin-error" role="alert">{{ text }}</p>
    }
  `,
  styles: `
    .lines {
      list-style: none;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  `,
})
export class VersionsPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly stepUp = inject(StepUpService);
  private readonly confirm = inject(ConfirmService);
  protected readonly cities = signal<CitySummary[]>([]);
  protected readonly lines = signal<LineSummary[]>([]);
  protected readonly searched = signal(false);
  protected readonly line = signal<LineDetail | null>(null);
  protected readonly versions = signal<VersionSummary[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly queryMax = LINE_QUERY_MAX;
  private citySlug = '';

  async ngOnInit(): Promise<void> {
    await this.guard(async () => this.cities.set(await this.api.cities()));
  }

  protected time(iso: string): string {
    return formatTime(iso);
  }

  protected fare(minor: number | null): string {
    return minor === 0 ? 'Ücretsiz' : (formatFare(minor) ?? '—');
  }

  async search(city: string, query: string): Promise<void> {
    if (!city) return;
    const q = query.trim().slice(0, LINE_QUERY_MAX);
    this.citySlug = city;
    this.line.set(null);
    await this.guard(async () => {
      this.lines.set(await this.api.lines(city, q));
      this.searched.set(true);
    });
  }

  async open(summary: LineSummary): Promise<void> {
    await this.guard(() => this.loadLine(summary.slug));
  }

  async rollback(line: LineDetail, version: VersionSummary): Promise<void> {
    if (this.busy()) return;
    const ok = await this.confirm.ask({
      title: `${line.code} sürüm ${version.version_no} geri yüklensin mi?`,
      body:
        `Sürüm ${version.version_no} kopyalanıp yeni bir sürüm olarak yayımlanır; eski kayıtlar değişmez. ` +
        'Bu işlem doğrulama kodu ister ve denetim kaydına yazılır.',
      confirmLabel: 'Geri al',
    });
    if (!ok) return;
    await this.guard(async () => {
      const created = await this.stepUp.run(() => this.api.rollback(line.id, version.version_no));
      this.message.set(`Geri alındı: yeni sürüm ${created.version_no} yayımlandı.`);
      await this.loadLine(line.slug);
    });
  }

  private async loadLine(slug: string): Promise<void> {
    const [line, versions] = await Promise.all([
      this.api.line(slug, this.citySlug),
      this.api.versions(slug, this.citySlug),
    ]);
    this.line.set(line);
    this.versions.set([...versions].sort((a, b) => b.version_no - a.version_no));
  }

  private async guard(task: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      await task();
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
