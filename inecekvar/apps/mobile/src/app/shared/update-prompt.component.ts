import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { TPipe } from '../i18n/i18n';

export type UpdateState = 'none' | 'ready' | 'broken';

/**
 * Shown when the service worker has downloaded a new app version (or found its cached files
 * damaged). The new version is used only after the user reloads, so an open screen is never
 * swapped underneath them; offline packs live outside the service worker and are kept.
 * Self-contained markup: this component is part of the initial bundle, and importing the UI
 * library barrel here would pull every library component into it.
 */
@Component({
  selector: 'iv-update-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TPipe],
  template: `
    @if (state() !== 'none') {
      <div class="bar" [class.warn]="state() === 'broken'" role="status">
        <span class="text">{{
          (state() === 'broken' ? 'update.broken' : 'update.ready') | t
        }}</span>
        <button type="button" (click)="reload()">{{ 'update.reload' | t }}</button>
      </div>
    }
  `,
  styles: `
    :host {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(76px + var(--ion-safe-area-bottom, 0px));
      z-index: 20;
      max-width: 616px;
      margin: 0 auto;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: var(--iv-radius-m);
      border: 1px solid var(--iv-line);
      border-left: 5px solid var(--iv-info);
      background: var(--iv-surface);
      color: var(--iv-ink);
      font-size: 14px;
      line-height: 1.4;
    }
    .bar.warn {
      border-left-color: var(--iv-ink);
    }
    .text {
      flex: 1;
      min-width: 0;
    }
    button {
      flex: none;
      min-height: 36px;
      padding: 0 12px;
      border: 0;
      border-radius: 999px;
      background: var(--iv-accent);
      color: var(--iv-accent-ink);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    button:focus-visible {
      outline: none;
      box-shadow: var(--iv-focus);
    }
  `,
})
export class UpdatePromptComponent {
  private readonly updates = inject(SwUpdate, { optional: true });
  private readonly document = inject(DOCUMENT);
  readonly state = signal<UpdateState>('none');

  constructor() {
    const updates = this.updates;
    if (!updates?.isEnabled) return;
    const ready = updates.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') this.state.set('ready');
    });
    const broken = updates.unrecoverable.subscribe(() => this.state.set('broken'));
    inject(DestroyRef).onDestroy(() => {
      ready.unsubscribe();
      broken.unsubscribe();
    });
  }

  async reload(): Promise<void> {
    if (this.state() === 'ready' && this.updates) {
      try {
        await this.updates.activateUpdate();
      } catch {
        // Reloading still picks up the new version.
      }
    }
    this.document.location.reload();
  }
}
