import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { StatusBadgeComponent } from '@inecekvar/ui';
import type { QueueEdit } from '../admin-api';
import { formatTime } from '../admin-text';
import { describeChanges, hasPhoto, KIND_LABELS, projectMapDiff } from '../queue/edit-diff';
import { QueueStore, REASON_MAX } from '../queue/queue.store';

@Component({
  selector: 'iv-admin-queue',
  imports: [StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h1>Moderasyon kuyruğu</h1>
      <button type="button" class="secondary" (click)="store.load()" [disabled]="store.loading()">
        {{ store.loading() ? 'Yükleniyor…' : 'Yenile' }}
      </button>
    </div>
    @if (store.notice(); as notice) {
      @if (!notice.editId) {
        <p [class]="notice.tone === 'ok' ? 'iv-admin-ok' : 'iv-admin-error'" role="status">
          {{ notice.text }}
        </p>
      }
    }
    @if (store.error(); as message) {
      <p class="iv-admin-error" role="alert">{{ message }}</p>
    }
    @if (store.loaded() && store.count() === 0) {
      <p class="iv-admin-card" data-queue="empty">Bekleyen öneri yok.</p>
    }
    @for (edit of store.items(); track edit.id) {
      <article class="iv-admin-card edit" [attr.data-edit]="edit.id" [attr.data-kind]="edit.kind">
        <header>
          <h2>{{ kind(edit.kind) }}</h2>
          <iv-status-badge tone="pending" label="Onay bekliyor" />
          <p class="iv-admin-muted">
            {{ edit.city }} · Öneren: <span class="text">{{ edit.author }}</span> ·
            {{ time(edit.created_at) }}
          </p>
          @if (store.isOwn(edit.id)) {
            <p class="own" data-own="true">Bu senin önerin; onaylayamaz ya da reddedemezsin.</p>
          }
        </header>
        <div class="body">
          @if (map(edit); as drawing) {
            <figure>
              <svg
                [attr.viewBox]="drawing.viewBox"
                role="img"
                [attr.aria-label]="mapLabel(edit.kind, drawing.changed)"
              >
                <rect width="100%" height="100%" fill="var(--iv-surface)" />
                @if (edit.kind === 'retire') {
                  <path
                    [attr.d]="drawing.before ?? drawing.after"
                    fill="none"
                    stroke="var(--iv-ink)"
                    stroke-width="5"
                    stroke-dasharray="12 8"
                  />
                } @else if (!drawing.changed) {
                  <path
                    [attr.d]="drawing.before"
                    fill="none"
                    stroke="var(--iv-ink)"
                    stroke-width="5"
                  />
                } @else {
                  @if (drawing.before) {
                    <path
                      [attr.d]="drawing.before"
                      fill="none"
                      stroke="var(--iv-ink-muted)"
                      stroke-width="6"
                      stroke-dasharray="10 6"
                    />
                  }
                  @if (drawing.after) {
                    <path
                      [attr.d]="drawing.after"
                      fill="none"
                      stroke="var(--iv-rail)"
                      stroke-width="4"
                    />
                  }
                }
              </svg>
              <figcaption>
                @if (edit.kind === 'retire') {
                  <span>Kesik çizgi: kaldırılacak güzergâh</span>
                } @else if (!drawing.changed) {
                  <span>Güzergâh değişmiyor (düz çizgi: şimdiki).</span>
                } @else {
                  <span>Kesik gri: şimdiki güzergâh</span>
                  <span>Düz çizgi: önerilen</span>
                }
              </figcaption>
            </figure>
          } @else {
            <p class="iv-admin-muted nomap">Harita farkı yok (güzergâh içermeyen öneri).</p>
          }
          <div>
            @if (changes(edit); as rows) {
              @if (rows.length > 0) {
                <table>
                  <caption class="iv-admin-muted">
                    Değişiklikler
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Alan</th>
                      <th scope="col">Şimdi</th>
                      <th scope="col">Önerilen</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of rows; track row.field) {
                      <tr [attr.data-field]="row.field">
                        <th scope="row">{{ row.label }}</th>
                        <td class="text">{{ row.from }}</td>
                        <td class="text">{{ row.to }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            }
            <p class="iv-admin-muted" data-photo>
              {{
                photo(edit)
                  ? 'Fotoğraf eklenmiş; önizleme yok (API bir okuma bağlantısı vermiyor).'
                  : 'Fotoğraf yok.'
              }}
            </p>
          </div>
        </div>
        @if (store.notice(); as notice) {
          @if (notice.editId === edit.id) {
            <p [class]="notice.tone === 'ok' ? 'iv-admin-ok' : 'iv-admin-error'" role="alert">
              {{ notice.text }}
            </p>
          }
        }
        @if (rejecting() === edit.id) {
          <form novalidate (submit)="$event.preventDefault(); reject(edit, reason.value)">
            <label [attr.for]="'iv-reason-' + edit.id">Ret gerekçesi (katkıcıya gösterilir)</label>
            <textarea
              #reason
              [id]="'iv-reason-' + edit.id"
              rows="3"
              required
              [attr.maxlength]="reasonMax"
              (input)="reasonLength.set(reason.value.length)"
              [disabled]="store.busy().has(edit.id)"
            ></textarea>
            <p class="iv-admin-muted">{{ reasonLength() }} / {{ reasonMax }}</p>
            <div class="iv-admin-actions">
              <button
                type="button"
                class="secondary"
                (click)="rejecting.set(null)"
                [disabled]="store.busy().has(edit.id)"
              >
                Vazgeç
              </button>
              <button type="submit" class="danger" [disabled]="store.busy().has(edit.id)">
                Reddet
              </button>
            </div>
          </form>
        } @else {
          <div class="iv-admin-actions">
            <button
              type="button"
              (click)="store.approve(edit)"
              [disabled]="store.busy().has(edit.id) || store.isOwn(edit.id)"
            >
              {{
                store.busy().has(edit.id)
                  ? 'İşleniyor…'
                  : edit.kind === 'retire'
                    ? 'Onayla ve kaldır'
                    : 'Onayla'
              }}
            </button>
            <button
              type="button"
              class="secondary"
              (click)="openReject(edit.id)"
              [disabled]="store.busy().has(edit.id) || store.isOwn(edit.id)"
            >
              Reddet…
            </button>
          </div>
        }
      </article>
    }
  `,
  styles: `
    .head {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      align-items: center;
      justify-content: space-between;
    }
    .edit header p {
      margin: 0.25rem 0;
    }
    .own {
      font-weight: 600;
      color: var(--iv-ink);
    }
    .body {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    }
    figure {
      margin: 0;
    }
    svg {
      width: 100%;
      height: auto;
      border: 1px solid var(--iv-line);
      border-radius: 0.5rem;
    }
    figcaption {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1rem;
      font-size: 0.875rem;
    }
    caption {
      text-align: left;
    }
  `,
})
export class QueuePage implements OnInit {
  protected readonly store = inject(QueueStore);
  protected readonly rejecting = signal<string | null>(null);
  protected readonly reasonLength = signal(0);
  protected readonly reasonMax = REASON_MAX;

  ngOnInit(): void {
    void this.store.load();
  }

  protected kind(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
  }

  protected time(iso: string): string {
    return formatTime(iso);
  }

  protected map(edit: QueueEdit) {
    return projectMapDiff(edit);
  }

  protected changes(edit: QueueEdit) {
    return describeChanges(edit);
  }

  protected photo(edit: QueueEdit): boolean {
    return hasPhoto(edit);
  }

  protected mapLabel(kind: string, changed: boolean): string {
    if (kind === 'retire') return 'Kaldırılacak güzergâh';
    return changed ? 'Güzergâh farkı: kesik gri şimdiki, turkuaz önerilen' : 'Güzergâh değişmiyor';
  }

  protected openReject(id: string): void {
    this.reasonLength.set(0);
    this.rejecting.set(id);
  }

  protected async reject(edit: QueueEdit, reason: string): Promise<void> {
    if (await this.store.reject(edit, reason)) this.rejecting.set(null);
  }
}
