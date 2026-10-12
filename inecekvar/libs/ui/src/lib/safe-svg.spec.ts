import { escapeXmlText, svgDocument, svgNumber, svgPathD, svgViewBox } from './safe-svg';

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
});
