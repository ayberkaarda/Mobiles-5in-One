import { ChangeDetectionStrategy, Component } from '@angular/core';
import { StatusPageComponent } from './status-page.component';

@Component({
  selector: 'iv-not-found-page',
  standalone: true,
  imports: [StatusPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<iv-status-page kind="not-found" />`,
})
export class NotFoundPage {}
