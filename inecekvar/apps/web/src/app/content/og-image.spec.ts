import { projectLine } from './line-geometry';
import { lineOgSvg } from './og-image';

describe('line social image', () => {
  it('renders a standalone brand frame with cased turquoise geometry', () => {
    const sketch = projectLine(
      [
        [29, 41],
        [29.1, 41.1],
      ],
      [],
      { width: 1200, height: 630, padding: 120 },
    );
    const svg = lineOgSvg({
      lineName: 'Örnek Hat',
      cityName: 'Örnek Şehir',
      modeLabel: 'minibüs',
      sketch,
    });
    expect(svg.startsWith('<svg xmlns=')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain('<rect width="1200" height="630" fill="#FFF8E7"/>');
    expect(svg).toContain('stroke="#14213D" stroke-width="14"');
    expect(svg).toContain('stroke="#2AB7CA" stroke-width="7"');
    expect(svg).toContain('Örnek Şehir · minibüs hattı');
    expect(svg).toContain('İnecek Var');
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelectorAll('path')).toHaveLength(3);
  });

  it.each(['</text><script>alert(1)</script>', '&', '"\'İı şğ çö ü', '\u2028\u0000'])(
    'escapes hostile labels %s',
    (name) => {
      const svg = lineOgSvg({ lineName: name, cityName: name, modeLabel: name, sketch: null });
      expect(svg.startsWith('<svg xmlns=')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).not.toContain('<script');
      expect(svg).not.toContain('</text><');
      expect(svg).not.toContain('\u2028');
      expect(svg).not.toContain('\u0000');
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(parsed.querySelector('parsererror')).toBeNull();
      expect(parsed.querySelector('script')).toBeNull();
      if (name.includes('<')) expect(svg).toContain('&lt;/text&gt;&lt;script&gt;');
      if (name === '&') expect(svg).toContain('&amp;');
      if (name.includes('"')) expect(svg).toContain('&quot;&apos;');
    },
  );

  it('renders a frame and readable text without geometry and clips names by code points', () => {
    const svg = lineOgSvg({
      lineName: '🚌'.repeat(80),
      cityName: 'İstanbul',
      modeLabel: 'dolmuş',
      sketch: null,
    });
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelectorAll('path')).toHaveLength(1);
    expect(parsed.querySelectorAll('text')).toHaveLength(3);
    expect(Array.from(parsed.querySelector('text')?.textContent ?? '').length).toBe(40);
  });

  it('rejects text in a numeric sketch path', () => {
    expect(() =>
      lineOgSvg({
        lineName: 'Hat',
        cityName: 'Şehir',
        modeLabel: 'minibüs',
        sketch: { width: 1200, height: 630, viewBox: '0 0 1200 630', pathD: '<script>', stops: [] },
      }),
    ).toThrow();
  });
});
