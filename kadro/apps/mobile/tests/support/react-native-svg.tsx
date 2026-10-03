import { createElement, type ReactNode } from 'react';

/**
 * Test double of `react-native-svg` (native views that do not load in Node). Each element renders
 * a host element of the same name with its props, so tests can assert colours, geometry, text and
 * accessibility of the diagrams and glyphs.
 */
type Props = Record<string, unknown> & { children?: ReactNode };

function element(name: string) {
  function SvgElement(props: Props) {
    return createElement(name, props);
  }
  SvgElement.displayName = name;
  return SvgElement;
}

const Svg = element('Svg');
export default Svg;
export { Svg };
export const Circle = element('Circle');
export const Rect = element('Rect');
export const Line = element('Line');
export const Path = element('Path');
export const G = element('G');

/**
 * SVG text keeps its props on an `SvgText` host; the string goes into a nested `Text` host
 * (the renderer accepts strings only there), so `getByText` finds diagram labels.
 */
export function Text({ children, ...props }: Props) {
  return createElement('SvgText', props, createElement('Text', null, children));
}
Text.displayName = 'SvgText';
export const TSpan = element('TSpan');
