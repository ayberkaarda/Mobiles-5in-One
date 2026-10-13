import { Component, InjectionToken, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DELETION_PANEL_LOADER, DeletionSlot } from './deletion-entry';

const FROM_CHILD = new InjectionToken<string>('FROM_CHILD');

@Component({ selector: 'iv-fake-panel', template: `<p data-fake>{{ value }}</p>` })
class FakePanel {
  readonly value = inject(FROM_CHILD);
}

afterEach(() => TestBed.resetTestingModule());

describe('DeletionSlot', () => {
  it('keeps the server text when no loader exists (server render, unit tests)', async () => {
    const fixture = TestBed.createComponent(DeletionSlot);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-deletion-fallback]')?.textContent).toMatch(
      /JavaScript gerektirir/,
    );
    expect(element.querySelector('form, input, button')).toBeNull();
  });

  it('mounts the lazy panel with its own providers after render', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DELETION_PANEL_LOADER,
          useValue: async () => ({
            component: FakePanel,
            providers: [{ provide: FROM_CHILD, useValue: 'child injector' }],
          }),
        },
      ],
    });
    const fixture = TestBed.createComponent(DeletionSlot);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-fake]')?.textContent).toBe('child injector');
    expect(element.querySelector('[data-deletion-fallback]')).toBeNull();
    expect(() => TestBed.inject(FROM_CHILD)).toThrow();
  });

  it('says so when the panel cannot be loaded', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DELETION_PANEL_LOADER, useValue: () => Promise.reject(new Error('offline')) },
      ],
    });
    const fixture = TestBed.createComponent(DeletionSlot);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('yüklenemedi');
  });
});
