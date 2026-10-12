import { pageTitle } from '../seo/seo';
import {
  cityDescription,
  citySubject,
  lineDescription,
  lineListDescription,
  lineListSubject,
  lineSubject,
  routeDescription,
  routeSubject,
  stopDescription,
  stopSubject,
} from './page-text';
import { cityData, lineData, stopData } from './test-data';

const length = (text: string) => Array.from(text).length;

describe('page text', () => {
  it.each([
    'Örnek',
    'İı şğ çö ü',
    '🚌'.repeat(200),
    'İstanbul Uzun Durak '.repeat(60),
    '</script><b> "İş" & \u2028\u0000'.repeat(20),
    '',
  ])('bounds every subject and description for %s', (name) => {
    const line = lineData({ name, stops: [stopData('ilk', name), stopData('son', name)] });
    const subjects = [
      lineSubject(name, 'minibus'),
      lineSubject(name, '<script>'),
      citySubject(name),
      lineListSubject(name, 1),
      lineListSubject(name, 2),
      lineListSubject(name, Number.MAX_SAFE_INTEGER),
      stopSubject(name, name),
      routeSubject(name, name),
      routeSubject(name, 'A'),
      routeSubject('A', name),
    ];
    for (const subject of subjects) {
      expect(length(subject)).toBeLessThanOrEqual(46);
      expect(length(pageTitle(subject))).toBeLessThanOrEqual(60);
      expect(subject).not.toContain(' | İnecek Var');
      expect(subject).not.toContain('\u2028');
      expect(subject).not.toContain('\u0000');
    }
    const descriptions = [
      lineDescription(line, name),
      cityDescription(cityData({ name })),
      cityDescription(cityData({ name, published_line_count: 0 })),
      lineListDescription(name, 1),
      lineListDescription(name, 2),
      stopDescription(name, name, 3),
      routeDescription(name, name, 2),
    ];
    for (const text of descriptions) {
      expect(length(text)).toBeLessThanOrEqual(155);
      expect(text).not.toContain('\u2028');
      expect(text).not.toContain('\u0000');
    }
  });

  it('chooses the first fitting line title candidate', () => {
    expect(lineSubject('A', 'dolmus')).toBe('A dolmuş hattı: duraklar, ücret, saatler');
    expect(lineSubject('Örnek Hat', 'minibus')).toBe('Örnek Hat minibüs hattı: duraklar ve ücret');
    expect(lineSubject('Ş'.repeat(30), 'minibus')).toBe('Ş'.repeat(30) + ' minibüs hattı');
    expect(lineSubject('Ş'.repeat(100), 'minibus')).toBe('Ş'.repeat(31) + '… minibüs hattı');
  });

  it('includes known endpoints, fare and date and omits missing parts', () => {
    expect(
      lineDescription(
        lineData({ name: 'A', stops: [stopData('ilk', 'B'), stopData('son', 'C')] }),
        'D',
      ),
    ).toBe(
      'A minibüs hattı (D): 2 durak, B – C. Ücret ₺27,50 (12 Ekim 2026). Saatler, ödeme ve durdurma notları.',
    );
    const unknown = lineDescription(
      lineData({ fare_minor: null, fare_updated_at: null, stops: [] }),
      'Şehir',
    );
    expect(unknown).toContain('0 durak.');
    expect(unknown).not.toContain('Ücret');
    expect(unknown).not.toContain(' – ');
    expect(unknown).not.toContain('undefined');
    expect(lineDescription(lineData({ fare_updated_at: null }), 'Şehir')).toContain(
      'Ücret ₺27,50.',
    );
  });

  it('uses city counts, page numbers and suffix-free stop and route names', () => {
    expect(citySubject('İzmir')).toBe('İzmir dolmuş ve minibüs hatları');
    expect(cityDescription(cityData({ name: 'İzmir' }))).toContain('İzmir için 50 yayımlanmış');
    expect(cityDescription(cityData({ name: 'İzmir', published_line_count: 0 }))).toContain(
      'İzmir için henüz yayımlanmış hat yok.',
    );
    expect(lineListSubject('İzmir', 1)).toBe('İzmir hat listesi');
    expect(lineListSubject('İzmir', 2)).toBe('İzmir hat listesi (sayfa 2)');
    expect(lineListDescription('İzmir', 2)).toContain('(sayfa 2)');
    expect(stopSubject('Öz', 'İzmir')).toBe('Öz durağı: geçen hatlar (İzmir)');
    expect(stopDescription('Öz', 'İzmir', 3)).toBe(
      'Öz durağı (İzmir): bu duraktan geçen 3 hat, ücret ve saat bilgisi.',
    );
    expect(routeSubject('Öz', 'Üç')).toBe('Öz–Üç arası hatlar');
    expect(routeDescription('Öz', 'Üç', 2)).toBe(
      'Öz ile Üç arasında aynı hatla gidilebilen 2 dolmuş ve minibüs hattı.',
    );
  });
});
