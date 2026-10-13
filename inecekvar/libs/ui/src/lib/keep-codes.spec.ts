import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KeepCodesComponent, splitCodes } from './keep-codes.component';
import { ItineraryStepsComponent } from './itinerary-steps.component';
import { LineCardComponent } from './line-card.component';

describe('splitCodes', () => {
  it('keeps hyphenated line codes as one run', () => {
    expect(splitCodes('[ÖRNEK] Hat ORN-1')).toEqual([
      { text: '[ÖRNEK] Hat ', keep: false },
      { text: 'ORN-1', keep: true },
    ]);
    expect(splitCodes('ORN-1 ile Kadıköy-Moda, sonra 34A-B2-7')).toEqual([
      { text: 'ORN-1', keep: true },
      { text: ' ile Kadıköy-Moda, sonra ', keep: false },
      { text: '34A-B2-7', keep: true },
    ]);
  });

  it('leaves text without codes as a single plain run', () => {
    expect(splitCodes('Moda - Kadıköy')).toEqual([{ text: 'Moda - Kadıköy', keep: false }]);
    expect(splitCodes('')).toEqual([]);
  });
});

@Component({
  imports: [KeepCodesComponent, LineCardComponent, ItineraryStepsComponent],
  template: `
    <h1><iv-keep-codes [text]="name()" /></h1>
    <iv-line-card
      code="ORN-1"
      [name]="name()"
      mode="dolmus"
      [labels]="{
        mode: 'Dolmuş',
        fare: 'Ücret',
        fareFree: 'Ücretsiz',
        fareUnknown: 'Bilinmiyor',
        favoriteAdd: 'Ekle',
        favoriteRemove: 'Çıkar',
      }"
    />
    <iv-itinerary-steps
      label="Adımlar"
      [steps]="[{ kind: 'ride', code: 'ORN-1', title: 'ORN-1 ile git', detail: '3 durak' }]"
    />
  `,
})
class Host {
  readonly name = signal('[ÖRNEK] Hat ORN-1');
}

describe('KeepCodesComponent', () => {
  it('renders the code inside an unbreakable span in titles, line cards and steps', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('[ÖRNEK] Hat ORN-1');
    for (const selector of ['h1', 'iv-line-card .name', 'iv-itinerary-steps .title']) {
      const code = el.querySelector(`${selector} iv-keep-codes .code`);
      expect(code?.textContent, selector).toBe('ORN-1');
      expect(getComputedStyle(code as Element).whiteSpace, selector).toBe('nowrap');
    }
    for (const plate of Array.from(el.querySelectorAll('.plate'))) {
      expect(getComputedStyle(plate).whiteSpace).toBe('nowrap');
    }
  });
});
