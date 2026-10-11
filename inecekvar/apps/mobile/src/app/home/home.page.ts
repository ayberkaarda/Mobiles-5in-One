import { Component } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'iv-home',
  imports: [IonHeader, IonToolbar, IonTitle, IonContent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>İnecek Var</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <h1>Dolmuş nereden geçer? Mahalle bilir.</h1>
      <p>Dolmuş, minibüs ve servis hatlarını mahalleliyle birlikte haritalıyoruz.</p>
    </ion-content>
  `,
})
export class HomePage {}
