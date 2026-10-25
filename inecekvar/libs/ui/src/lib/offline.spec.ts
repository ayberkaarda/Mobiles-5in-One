import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoticeComponent, NoticeTone } from './notice.component';
import { ProgressBarComponent } from './progress-bar.component';

@Component({
  imports: [ProgressBarComponent, NoticeComponent],
  template: `
    <iv-progress-bar [value]="value()" label="Paket iniyor" />
    <iv-notice
      [tone]="tone()"
      heading="Yeni sürüm"
      [message]="message()"
      [actionLabel]="action()"
      (action)="clicks.set(clicks() + 1)"
    />
  `,
})
class Host {
  readonly value = signal<number | null>(0.42);
  readonly tone = signal<NoticeTone>('info');
  readonly message = signal('Hazır');
  readonly action = signal('Yenile');
  readonly clicks = signal(0);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return { fixture, root, host: fixture.componentInstance };
}

describe('ProgressBarComponent', () => {
  it('reports the percentage and clamps it', () => {
    const { fixture, root, host } = render();
    const bar = root.querySelector('iv-progress-bar') as HTMLElement;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.getAttribute('aria-label')).toBe('Paket iniyor');
    host.value.set(3);
    fixture.detectChanges();
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  it('is indeterminate without a value', () => {
    const { fixture, root, host } = render();
    host.value.set(null);
    fixture.detectChanges();
    const bar = root.querySelector('iv-progress-bar') as HTMLElement;
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.classList).toContain('iv-progress--indeterminate');
  });
});

describe('NoticeComponent', () => {
  it('shows text as text and emits its action', () => {
    const { fixture, root, host } = render();
    host.message.set('<img src=x onerror=alert(1)>');
    fixture.detectChanges();
    const notice = root.querySelector('iv-notice') as HTMLElement;
    expect(notice.querySelector('img')).toBeNull();
    expect(notice.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(notice.getAttribute('role')).toBe('status');
    (notice.querySelector('button') as HTMLButtonElement).click();
    expect(host.clicks()).toBe(1);
  });

  it('is an alert when it warns and has no button without a label', () => {
    const { fixture, root, host } = render();
    host.tone.set('warn');
    host.action.set('');
    fixture.detectChanges();
    const notice = root.querySelector('iv-notice') as HTMLElement;
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.querySelector('button')).toBeNull();
  });

  it('marks every tone with its own shape and announces errors as alerts', () => {
    const { fixture, root, host } = render();
    const shapes = new Set<string>();
    for (const tone of ['info', 'offline', 'warn', 'error'] as const) {
      host.tone.set(tone);
      fixture.detectChanges();
      const notice = root.querySelector('iv-notice') as HTMLElement;
      const mark = notice.querySelector('svg.mark') as SVGElement;
      expect(mark.getAttribute('aria-hidden')).toBe('true');
      shapes.add(
        Array.from(mark.children)
          .map((shape) => `${shape.tagName}:${shape.getAttribute('d') ?? shape.getAttribute('r')}`)
          .join('|'),
      );
      expect(notice.classList).toContain('iv-notice--' + tone);
      expect(notice.getAttribute('role')).toBe(
        tone === 'warn' || tone === 'error' ? 'alert' : 'status',
      );
    }
    expect(shapes.size).toBe(4);
  });
});
