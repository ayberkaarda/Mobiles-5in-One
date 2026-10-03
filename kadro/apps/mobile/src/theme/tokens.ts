// `@kadro/brand` is the single source of the design tokens (ADR-0084). The mobile package reads
// the built native module by path from the workspace (ADR-0047); a relative import of the file
// is equivalent to `@kadro/brand/tokens`, and Metro bundles it like any other module.
import { type ColorScheme } from '../../../../packages/brand/theme/tokens';

export {
  type ColorPreference,
  type ColorRole,
  type ColorRoles,
  type ColorScheme,
  colors,
  elevation,
  fixedColorRoles,
  layout,
  motion,
  type NativeFontName,
  nativeFontFiles,
  type OverlayRole,
  overlays,
  pitchDiagram,
  radius,
  type ShadowToken,
  spacing,
  state,
  type TextStyleToken,
  theming,
  type TypeVariant,
  typeScale,
} from '../../../../packages/brand/theme/tokens';

/** The resolved scheme the theme is built for (`light` or `dark`). */
export type ColorSchemeName = ColorScheme;
