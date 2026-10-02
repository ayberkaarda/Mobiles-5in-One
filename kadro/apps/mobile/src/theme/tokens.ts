// `@kadro/brand` is the single source of the design tokens (product spec §2). The mobile package
// does not list it as a dependency yet, so the JSON is read by path from the workspace; Metro
// watches the workspace root and bundles it like any other module.
import brandTokens from '../../../../packages/brand/tokens.json';

export type ColorSchemeName = 'light' | 'dark';

/** Semantic color roles defined by the brand tokens for each scheme. */
export interface BrandThemeColors {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly textMuted: string;
  readonly primary: string;
  readonly onPrimary: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly warning: string;
  readonly onWarning: string;
  readonly danger: string;
  readonly onDanger: string;
  readonly link: string;
}

export type TypeVariant =
  | 'caption'
  | 'footnote'
  | 'label'
  | 'body'
  | 'bodyStrong'
  | 'title3'
  | 'title2'
  | 'title1'
  | 'display'
  | 'score';

export type FontRole = 'display' | 'body' | 'numeric';

export interface TypeScaleEntry {
  readonly family: FontRole;
  readonly size: number;
  readonly lineHeight: number;
  readonly weight: 400 | 500 | 600 | 700;
  readonly fontFeature?: 'tabular-nums';
}

export type SpacingStep = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '8' | '10' | '12' | '16';
export type RadiusName = 'sm' | 'md' | 'lg' | 'full';

export interface BrandTokens {
  readonly colorThemes: Readonly<Record<ColorSchemeName, BrandThemeColors>>;
  readonly fontFamily: Readonly<Record<FontRole, string>>;
  readonly typeScale: Readonly<Record<TypeVariant, TypeScaleEntry>>;
  readonly spacing: Readonly<Record<SpacingStep, number>>;
  readonly radius: Readonly<Record<RadiusName, number>>;
}

/** The brand token file, narrowed to the shapes the theme consumes. */
export const tokens: BrandTokens = {
  colorThemes: brandTokens.color.theme,
  fontFamily: brandTokens.typography.fontFamily as Record<FontRole, string>,
  typeScale: brandTokens.typography.scale as Record<TypeVariant, TypeScaleEntry>,
  spacing: brandTokens.spacing,
  radius: brandTokens.radius,
};
