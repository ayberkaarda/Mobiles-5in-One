export interface SvgPoint {
  x: number;
  y: number;
}

export type SvgColor =
  '#F2B705' | '#14213D' | '#FFFFFF' | '#FFF8E7' | '#2AB7CA' | '#6C757D' | '#D7263D' | '#2E8B57';

const colors: readonly SvgColor[] = [
  '#F2B705',
  '#14213D',
  '#FFFFFF',
  '#FFF8E7',
  '#2AB7CA',
  '#6C757D',
  '#D7263D',
  '#2E8B57',
];

export function svgNumber(value: number): string {
  // Fixed notation stops at this boundary, so reject larger geometry.
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) {
    throw new Error('Invalid SVG number');
  }
  const text = value.toFixed(2).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
}

export function svgPathD(points: readonly SvgPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${svgNumber(point.x)} ${svgNumber(point.y)}`)
    .join(' ');
}

export function svgViewBox(width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid SVG dimensions');
  }
  return `0 0 ${svgNumber(width)} ${svgNumber(height)}`;
}

export function escapeXmlText(value: string): string {
  const valid = Array.from(value)
    .filter((character) => {
      const point = character.codePointAt(0) as number;
      return (
        point !== 0x2028 &&
        point !== 0x2029 &&
        (point === 0x09 ||
          point === 0x0a ||
          point === 0x0d ||
          (point >= 0x20 && point <= 0xd7ff) ||
          (point >= 0xe000 && point <= 0xfffd) ||
          (point >= 0x10000 && point <= 0x10ffff))
      );
    })
    .join('');
  return valid
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function svgDocument(model: {
  width: number;
  height: number;
  title: string;
  paths: { points: SvgPoint[]; stroke: SvgColor; width: number }[];
  labels: { x: number; y: number; text: string }[];
}): string {
  const viewBox = svgViewBox(model.width, model.height);
  const paths = model.paths.map((path) => {
    if (!colors.includes(path.stroke) || path.width <= 0) {
      throw new Error('Invalid SVG stroke');
    }
    return (
      `<path d="${svgPathD(path.points)}" fill="none" stroke="${path.stroke}"` +
      ` stroke-width="${svgNumber(path.width)}"/>`
    );
  });
  const labels = model.labels.map(
    (label) =>
      `<text x="${svgNumber(label.x)}" y="${svgNumber(label.y)}" fill="#14213D">` +
      escapeXmlText(label.text) +
      '</text>',
  );
  // This standalone image string is never an HTML insertion source.
  return (
    '<svg xmlns="http://www.w3.org/2000/svg"' +
    ` width="${svgNumber(model.width)}" height="${svgNumber(model.height)}" viewBox="${viewBox}">` +
    `<title>${escapeXmlText(model.title)}</title>` +
    paths.join('') +
    labels.join('') +
    '</svg>'
  );
}
