import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { UpdatePromptComponent } from './shared/update-prompt.component';

@Component({
  selector: 'iv-root',
  imports: [IonApp, IonRouterOutlet, UpdatePromptComponent],
  template: `
    <ion-app>
      <ion-router-outlet />
      <iv-update-prompt />
    </ion-app>
  `,
})
export class App {}
