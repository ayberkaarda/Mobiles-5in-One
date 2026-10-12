import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { SessionStore } from '@inecekvar/data-access';
import { PlusOffer, PURCHASES_ADAPTER } from './purchases';

export type PlusAvailability = 'web' | 'not-configured' | 'store';

export type PlusState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'purchasing'
  | 'purchased'
  | 'cancelled'
  | 'restoring'
  | 'restored'
  | 'error';

/**
 * The paywall's state. It sells Plus through the bound `PurchasesAdapter` and reports what the
 * store said, but it never unlocks anything: the API grants extra city packs only from its own
 * subscription records, filled by the store webhook (phase 5). After a purchase the user is
 * sent back to the packs, where the next download asks the API again.
 */
@Injectable({ providedIn: 'root' })
export class PlusStore {
  private readonly adapter = inject(PURCHASES_ADAPTER);
  private readonly session = inject(SessionStore);
  private generation = 0;
  private identifiedAs: string | null = null;

  readonly availability: PlusAvailability = this.adapter.unavailable ?? 'store';
  readonly state = signal<PlusState>('idle');
  readonly offers = signal<readonly PlusOffer[]>([]);
  /** What the store SDK reports after a purchase or restore; a hint, never a grant. */
  readonly storeSaysPlus = signal(false);
  /** Purchases are tied to the API account, so the store needs a signed-in user. */
  readonly needsSignIn = computed(
    () => this.availability === 'store' && !this.session.isSignedIn(),
  );
  readonly busy = computed(() => ['loading', 'purchasing', 'restoring'].includes(this.state()));

  constructor() {
    effect(() => {
      const id = this.session.user()?.id ?? null;
      untracked(() => this.onUser(id));
    });
  }

  /** Loads the offers for the signed-in account; does nothing on the web. */
  async load(): Promise<void> {
    const user = this.session.user();
    if (this.availability !== 'store' || !user || this.busy()) return;
    const run = ++this.generation;
    this.state.set('loading');
    try {
      if (this.identifiedAs !== user.id) {
        await this.adapter.identify(user.id);
        this.identifiedAs = user.id;
      }
      const offers = await this.adapter.offers();
      if (run !== this.generation) return;
      this.offers.set(offers);
      this.state.set('ready');
    } catch {
      if (run === this.generation) this.state.set('error');
    }
  }

  async buy(offerId: string): Promise<void> {
    if (this.availability !== 'store' || !this.session.isSignedIn() || this.busy()) return;
    const run = ++this.generation;
    this.state.set('purchasing');
    try {
      const outcome = await this.adapter.purchase(offerId);
      if (run !== this.generation) return;
      if (outcome === 'cancelled') {
        this.state.set('cancelled');
        return;
      }
      this.storeSaysPlus.set(await this.adapter.storeSaysPlus().catch(() => false));
      if (run === this.generation) this.state.set('purchased');
    } catch {
      if (run === this.generation) this.state.set('error');
    }
  }

  async restore(): Promise<void> {
    if (this.availability !== 'store' || !this.session.isSignedIn() || this.busy()) return;
    const run = ++this.generation;
    this.state.set('restoring');
    try {
      await this.adapter.restore();
      const plus = await this.adapter.storeSaysPlus().catch(() => false);
      if (run !== this.generation) return;
      this.storeSaysPlus.set(plus);
      this.state.set('restored');
    } catch {
      if (run === this.generation) this.state.set('error');
    }
  }

  private onUser(id: string | null): void {
    if (id === this.identifiedAs) return;
    this.generation += 1;
    const had = this.identifiedAs !== null;
    this.identifiedAs = null;
    this.offers.set([]);
    this.storeSaysPlus.set(false);
    this.state.set('idle');
    // Another account or nobody: the store SDK must not keep the previous app user id.
    if (had) void this.adapter.forget().catch(() => undefined);
  }
}
