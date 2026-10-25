export interface SvgPoint {
  x: number;
  y: number;
}

/** Colours a standalone SVG may use: the current palette first, then the former one. */
export type SvgColor =
  | '#B3261E'
  | '#1F2124'
  | '#DADBD6'
  | '#34557A'
  | '#5A5D62'
  | '#1F6B42'
  | '#F59E2E'
  | '#121417'
  | '#F2B705'
  | '#14213D'
  | '#FFFFFF'
  | '#FFF8E7'
  | '#2AB7CA'
  | '#6C757D'
  | '#D7263D'
  | '#2E8B57';

const colors: readonly SvgColor[] = [
  '#B3261E',
  '#1F2124',
  '#DADBD6',
  '#34557A',
  '#5A5D62',
  '#1F6B42',
  '#F59E2E',
  '#121417',
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
  background?: SvgColor;
  /** Fill of the labels; the former lacivert when left out. */
  labelFill?: SvgColor;
  paths: { points: SvgPoint[]; stroke: SvgColor; width: number }[];
  labels: { x: number; y: number; text: string; size?: number; weight?: 'normal' | 'bold' }[];
}): string {
  const viewBox = svgViewBox(model.width, model.height);
  if (model.background !== undefined && !colors.includes(model.background)) {
    throw new Error('Invalid SVG background');
  }
  const labelFill = model.labelFill ?? '#14213D';
  if (!colors.includes(labelFill)) {
    throw new Error('Invalid SVG label fill');
  }
  const background =
    model.background === undefined
      ? ''
      : `<rect width="${svgNumber(model.width)}" height="${svgNumber(model.height)}" fill="${model.background}"/>`;
  const paths = model.paths.map((path) => {
    if (!colors.includes(path.stroke) || path.width <= 0) {
      throw new Error('Invalid SVG stroke');
    }
    return (
      `<path d="${svgPathD(path.points)}" fill="none" stroke="${path.stroke}"` +
      ` stroke-width="${svgNumber(path.width)}"/>`
    );
  });
  const labels = model.labels.map((label) => {
    if (
      label.size !== undefined &&
      (!Number.isFinite(label.size) || label.size < 8 || label.size > 120)
    ) {
      throw new Error('Invalid SVG label size');
    }
    if (label.weight !== undefined && label.weight !== 'normal' && label.weight !== 'bold') {
      throw new Error('Invalid SVG label weight');
    }
    const size = label.size === undefined ? '' : ` font-size="${svgNumber(label.size)}"`;
    const weight = label.weight === undefined ? '' : ` font-weight="${label.weight}"`;
    return (
      `<text x="${svgNumber(label.x)}" y="${svgNumber(label.y)}" fill="${labelFill}"${size}${weight}>` +
      escapeXmlText(label.text) +
      '</text>'
    );
  });
  // This standalone image string is never an HTML insertion source.
  return (
    '<svg xmlns="http://www.w3.org/2000/svg"' +
    ` width="${svgNumber(model.width)}" height="${svgNumber(model.height)}" viewBox="${viewBox}">` +
    background +
    `<title>${escapeXmlText(model.title)}</title>` +
    paths.join('') +
    labels.join('') +
    '</svg>'
  );
}
