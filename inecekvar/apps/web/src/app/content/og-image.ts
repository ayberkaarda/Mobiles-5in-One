import { svgDocument, SvgPoint } from '@inecekvar/ui';
import { clampText } from '../seo/seo';
import { LineSketch } from './line-geometry';

function sketchPoints(sketch: LineSketch): SvgPoint[] {
  if (
    !/^M -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?(?: L -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?)*$/.test(sketch.pathD)
  ) {
    throw new Error('Invalid sketch path');
  }
  // Rebuild through numeric points so the SVG writer remains the only markup boundary.
  return Array.from(
    sketch.pathD.matchAll(/[ML] (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g),
    (match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
    }),
  );
}

export function lineOgSvg(input: {
  lineName: string;
  cityName: string;
  modeLabel: string;
  sketch: LineSketch | null;
}): string {
  const points = input.sketch ? sketchPoints(input.sketch) : [];
  const name = clampText(input.lineName, 40);
  return svgDocument({
    width: 1200,
    height: 630,
    title: name + ' | İnecek Var',
    background: '#FFF8E7',
    paths: [
      {
        points: [
          { x: 36, y: 36 },
          { x: 1164, y: 36 },
          { x: 1164, y: 594 },
          { x: 36, y: 594 },
          { x: 36, y: 36 },
        ],
        stroke: '#14213D',
        width: 8,
      },
      ...(points.length
        ? [
            { points, stroke: '#14213D' as const, width: 14 },
            { points, stroke: '#2AB7CA' as const, width: 7 },
          ]
        : []),
    ],
    labels: [
      { x: 64, y: 92, text: name, size: 40, weight: 'bold' },
      {
        x: 64,
        y: 128,
        text: `${clampText(input.cityName, 60)} · ${clampText(input.modeLabel, 20)} hattı`,
        size: 24,
      },
      { x: 64, y: 570, text: 'İnecek Var', size: 28, weight: 'bold' },
    ],
  }).replace(/<\/text></g, '</text>\n<');
}
