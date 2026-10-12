import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { StateComponent } from '@inecekvar/ui';
import { TPipe } from '../i18n/i18n';

@Component({
  selector: 'iv-not-found-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, StateComponent, TPipe],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'app.name' | t }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="iv-page">
        <iv-state
          kind="error"
          [heading]="'notFound.title' | t"
          [message]="'notFound.body' | t"
          [actionLabel]="'notFound.action' | t"
          (action)="goHome()"
        />
      </div>
    </ion-content>
  `,
})
export class NotFoundPage {
  private readonly router = inject(Router);

  protected goHome(): void {
    void this.router.navigateByUrl('/ara');
  }
}
