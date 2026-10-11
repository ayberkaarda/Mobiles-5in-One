import { TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular';
import { HomePage } from './home/home.page';

describe('HomePage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideIonicAngular({})],
    }).compileComponents();
  });

  it('shows the brand name and the Turkish tagline', async () => {
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ion-title')?.textContent).toContain('İnecek Var');
    expect(element.querySelector('h1')?.textContent).toContain(
      'Dolmuş nereden geçer? Mahalle bilir.',
    );
  });
});
