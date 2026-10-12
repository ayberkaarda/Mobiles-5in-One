import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  megaphoneOutline,
  navigateOutline,
  searchOutline,
  settingsOutline,
  starOutline,
} from 'ionicons/icons';
import { LicenceDialogComponent } from '../auth/licence-dialog.component';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';

export interface TabDef {
  path: string;
  icon: string;
  label: TranslationKey;
}

export const TABS: readonly TabDef[] = [
  { path: 'ara', icon: 'search-outline', label: 'tabs.search' },
  { path: 'planla', icon: 'navigate-outline', label: 'tabs.plan' },
  { path: 'favoriler', icon: 'star-outline', label: 'tabs.favorites' },
  { path: 'katki', icon: 'megaphone-outline', label: 'tabs.contribute' },
  { path: 'ayarlar', icon: 'settings-outline', label: 'tabs.settings' },
];

/** Bottom tab shell; each tab is a lazily loaded route. */
@Component({
  selector: 'iv-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, LicenceDialogComponent, TPipe],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom" [attr.aria-label]="'tabs.label' | t">
        @for (tab of tabs; track tab.path) {
          <ion-tab-button [tab]="tab.path">
            <ion-icon [name]="tab.icon" aria-hidden="true" />
            <ion-label>{{ tab.label | t }}</ion-label>
          </ion-tab-button>
        }
      </ion-tab-bar>
    </ion-tabs>
    <iv-licence-dialog />
  `,
})
export class TabsPage {
  protected readonly tabs = TABS;

  constructor() {
    addIcons({ searchOutline, navigateOutline, starOutline, megaphoneOutline, settingsOutline });
  }
}
