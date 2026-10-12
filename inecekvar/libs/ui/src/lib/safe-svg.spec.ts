import { escapeXmlText, SvgColor, svgDocument, svgNumber, svgPathD, svgViewBox } from './safe-svg';

describe('safe SVG', () => {
  it('escapes labels and titles and stays a valid SVG document', () => {
    const payload = '</text><script>alert(1)</script>';
    const text = svgDocument({
      width: 1200,
      height: 630,
      title: '<script> & "İnecek Var"',
      paths: [
        {
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
          stroke: '#F2B705',
          width: 2,
        },
      ],
      labels: [{ x: 10, y: 20, text: payload }],
    });
    expect(text).toContain('&lt;/text&gt;&lt;script&gt;');
    expect(text).not.toContain('<script>');
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelector('script')).toBeNull();
    expect(parsed.querySelector('text')?.textContent).toBe(payload);
    expect(parsed.documentElement.localName).toBe('svg');
  });

  it.each([NaN, Infinity, -Infinity, 1e21, -1e21])('rejects invalid geometry %s', (value) => {
    expect(() => svgNumber(value)).toThrow();
    expect(() => svgPathD([{ x: value, y: 0 }])).toThrow();
    expect(() => svgViewBox(100, value)).toThrow();
  });

  it('formats numbers without exponent notation or negative zero', () => {
    expect(svgNumber(1e-7)).toBe('0');
    expect(svgNumber(-0)).toBe('0');
    expect(svgNumber(-0.001)).toBe('0');
    expect(svgNumber(12.345)).toBe('12.35');
    expect(svgNumber(100)).toBe('100');
    expect(svgNumber(1e20)).toBe('100000000000000000000');
    expect(
      svgPathD([
        { x: 1, y: 2 },
        { x: 3.5, y: 4 },
      ]),
    ).toBe('M 1 2 L 3.5 4');
  });

  it('drops invalid XML characters while preserving Turkish text and emoji', () => {
    expect(escapeXmlText('\u0000\ud800\uffff\u2028\u2029İşğü 🚌 &<>"\'')).toBe(
      'İşğü 🚌 &amp;&lt;&gt;&quot;&apos;',
    );
  });

  it('preserves the exact document bytes when optional presentation fields are absent', () => {
    expect(
      svgDocument({
        width: 100,
        height: 50,
        title: 'İş & ü',
        paths: [
          {
            points: [
              { x: 1, y: 2 },
              { x: 3, y: 4 },
            ],
            stroke: '#2AB7CA',
            width: 2,
          },
        ],
        labels: [{ x: 10, y: 20, text: 'Öz' }],
      }),
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">' +
        '<title>İş &amp; ü</title><path d="M 1 2 L 3 4" fill="none" stroke="#2AB7CA" stroke-width="2"/>' +
        '<text x="10" y="20" fill="#14213D">Öz</text></svg>',
    );
  });

  it('writes the background first and optional label size and weight safely', () => {
    const svg = svgDocument({
      width: 1200,
      height: 630,
      title: 'Hat',
      background: '#FFF8E7',
      paths: [],
      labels: [
        { x: 10, y: 20, text: '<b>İş</b>', size: 40.5, weight: 'bold' },
        { x: 10, y: 40, text: 'Öz', size: 8, weight: 'normal' },
        { x: 10, y: 60, text: 'Üç', size: 120 },
      ],
    });
    expect(svg).toContain('><rect width="1200" height="630" fill="#FFF8E7"/><title>');
    expect(svg).toContain('font-size="40.5" font-weight="bold">&lt;b&gt;İş&lt;/b&gt;');
    expect(svg).toContain('font-size="8" font-weight="normal"');
    expect(svg).toContain('font-size="120"');
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.documentElement.firstElementChild?.localName).toBe('rect');
  });

  it.each([NaN, Infinity, -Infinity, 7.99, 120.01])('rejects an invalid label size %s', (size) => {
    expect(() =>
      svgDocument({
        width: 100,
        height: 50,
        title: 'Hat',
        paths: [],
        labels: [{ x: 1, y: 2, text: 'Hat', size }],
      }),
    ).toThrow();
  });

  it('rejects unrecognized background colours and label weights at runtime', () => {
    expect(() =>
      svgDocument({
        width: 100,
        height: 50,
        title: 'Hat',
        paths: [],
        labels: [],
        background: 'red' as SvgColor,
      }),
    ).toThrow();
    expect(() =>
      svgDocument({
        width: 100,
        height: 50,
        title: 'Hat',
        paths: [],
        labels: [{ x: 1, y: 2, text: 'Hat', weight: 'heavy' as 'bold' }],
      }),
    ).toThrow();
  });
});
