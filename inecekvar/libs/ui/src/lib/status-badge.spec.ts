import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StatusBadgeComponent, StatusTone } from './status-badge.component';

@Component({
  imports: [StatusBadgeComponent],
  template: `<iv-status-badge [tone]="tone()" [label]="label()" />`,
})
class Host {
  readonly tone = signal<StatusTone>('pending');
  readonly label = signal('Bekliyor');
}

describe('StatusBadgeComponent', () => {
  it('shows the label as text with a shape per tone', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('iv-status-badge');
    expect(badge?.getAttribute('data-tone')).toBe('pending');
    expect(badge?.textContent?.trim()).toBe('Bekliyor');
    expect(badge?.querySelector('circle')).not.toBeNull();

    fixture.componentInstance.tone.set('rejected');
    fixture.componentInstance.label.set('<b>Reddedildi</b>');
    fixture.detectChanges();
    expect(badge?.getAttribute('data-tone')).toBe('rejected');
    // Text only: markup in a label is never parsed.
    expect(badge?.querySelector('b')).toBeNull();
    expect(badge?.textContent?.trim()).toBe('<b>Reddedildi</b>');
    expect(badge?.querySelector('circle')).toBeNull();
    expect(badge?.querySelector('path')?.getAttribute('d')).toContain('M4 4l8 8');
  });
});
