import { TestBed } from '@angular/core/testing';
import { Home } from './home/home';

describe('Home', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Home] }).compileComponents();
  });

  it('renders the brand name and the Turkish tagline', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toContain('İnecek Var');
    expect(element.querySelector('.tagline')?.textContent).toContain(
      'Dolmuş nereden geçer? Mahalle bilir.',
    );
  });
});
