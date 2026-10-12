import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { StateComponent } from '@inecekvar/ui';
import { TPipe } from '../i18n/i18n';
import { BackButtonComponent } from '../shared/back-button.component';

/** `/giris`: placeholder until the sign-in screens of package 3G replace it. */
@Component({
  selector: 'iv-signin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonTitle,
    IonContent,
    BackButtonComponent,
    StateComponent,
    TPipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <iv-back-button />
        </ion-buttons>
        <ion-title>{{ 'signin.title' | t }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="iv-page">
        <iv-state
          [heading]="'signin.heading' | t"
          [message]="'signin.body' | t"
          [actionLabel]="'signin.back' | t"
          (action)="back()"
        />
      </div>
    </ion-content>
  `,
})
export class SigninPage {
  private readonly router = inject(Router);

  protected back(): void {
    void this.router.navigateByUrl('/favoriler');
  }
}
