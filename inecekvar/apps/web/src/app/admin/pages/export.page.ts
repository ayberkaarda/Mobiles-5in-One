import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { AdminApi, type AdminExport, type CitySummary } from '../admin-api';
import { adminErrorMessage } from '../admin-errors';
import { formatTime } from '../admin-text';
import { StepUpService } from '../step-up/step-up.service';

/** Administrative export per city (admin only, step-up, 10 per hour, ADR-0037 item 12). */
@Component({
  selector: 'iv-admin-export',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Şehir dışa aktarımı</h1>
    <form class="iv-admin-card box" (submit)="$event.preventDefault(); run(city.value)">
      <p class="iv-admin-muted">
        Seçilen şehrin yayındaki hatları ve durakları açık veri dosyası olarak yeniden üretilir.
        Saatte en fazla 10 kez çalışır.
      </p>
      <label for="iv-export-city">Şehir</label>
      <select id="iv-export-city" #city [disabled]="busy()">
        @for (item of cities(); track item.slug) {
          <option [value]="item.slug">{{ item.name }}</option>
        }
      </select>
      <div class="iv-admin-actions">
        <button type="submit" [disabled]="busy() || cities().length === 0">
          {{ busy() ? 'Dışa aktarılıyor…' : 'Dışa aktar' }}
        </button>
      </div>
    </form>
    @if (result(); as done) {
      <p class="iv-admin-ok" role="status" data-export="done">
        {{ done.city }}: sürüm {{ done.version }} hazır ({{ time(done.published_at) }}).
      </p>
    }
    @if (error(); as text) {
      <p class="iv-admin-error" role="alert">{{ text }}</p>
    }
  `,
  styles: `
    .box {
      max-width: 28rem;
    }
  `,
})
export class ExportPage implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly stepUp = inject(StepUpService);
  protected readonly cities = signal<CitySummary[]>([]);
  protected readonly result = signal<AdminExport | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.cities.set(await this.api.cities());
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected time(iso: string): string {
    return formatTime(iso);
  }

  async run(city: string): Promise<void> {
    if (this.busy() || !/^[a-z0-9-]{1,120}$/.test(city)) return;
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      this.result.set(await this.stepUp.run(() => this.api.exportCity(city)));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
