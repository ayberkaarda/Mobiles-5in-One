// Font files ship in `@kadro/brand` (SIL OFL); read by path like the tokens (see tokens.ts).
import interFont from '../../../../packages/brand/fonts/inter/Inter-VariableFont.ttf';
import soraFont from '../../../../packages/brand/fonts/sora/Sora-VariableFont_wght.ttf';

import { tokens } from './tokens';

/**
 * Font map for `expo-font`. The keys are the family names the theme puts in `fontFamily`
 * (`Inter`, `Sora`), so text renders in the brand faces once the map is loaded.
 */
export const FONT_MAP: Readonly<Record<string, number>> = {
  [tokens.fontFamily.body]: interFont,
  [tokens.fontFamily.display]: soraFont,
};
