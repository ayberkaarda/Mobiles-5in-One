import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { StateComponent } from '@inecekvar/ui';
import { TPipe } from '../i18n/i18n';

@Component({
  selector: 'iv-plan-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, StateComponent, TPipe],
  templateUrl: './plan.page.html',
  styleUrl: './plan.page.scss',
})
export class PlanPage {
  private readonly router = inject(Router);

  protected readonly from = signal('');
  protected readonly to = signal('');
  /** Set when the user asks for a route; no city pack is installed yet, so planning stops there. */
  protected readonly submitted = signal(false);
  protected readonly canSubmit = computed(
    () => this.from().trim() !== '' && this.to().trim() !== '',
  );

  protected onInput(field: 'from' | 'to', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    (field === 'from' ? this.from : this.to).set(value);
    this.submitted.set(false);
  }

  protected swap(): void {
    const from = this.from();
    this.from.set(this.to());
    this.to.set(from);
  }

  protected submit(): void {
    if (this.canSubmit()) this.submitted.set(true);
  }

  protected goToSearch(): void {
    void this.router.navigateByUrl('/ara');
  }
}
