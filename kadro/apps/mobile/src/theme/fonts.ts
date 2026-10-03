// Font files ship in `@kadro/brand` (SIL OFL); read by path like the tokens (see tokens.ts).
// React Native cannot select the axes of a variable font (Android in particular), so the app
// loads the five static Archivo instances; each type token names its instance in `fontFamily`.
import archivoMedium from '../../../../packages/brand/fonts/archivo/static/Archivo-Medium.ttf';
import archivoRegular from '../../../../packages/brand/fonts/archivo/static/Archivo-Regular.ttf';
import archivoSemiBold from '../../../../packages/brand/fonts/archivo/static/Archivo-SemiBold.ttf';
import archivoCondensedBold from '../../../../packages/brand/fonts/archivo/static/ArchivoCondensed-Bold.ttf';
import archivoCondensedExtraBold from '../../../../packages/brand/fonts/archivo/static/ArchivoCondensed-ExtraBold.ttf';

import { type NativeFontName } from './tokens';

/**
 * Font map for `expo-font`. The keys are the instance names of `nativeFontFiles`, which are also
 * the `fontFamily` of every type token, so text renders in Archivo once the map is loaded.
 */
export const FONT_MAP: Readonly<Record<NativeFontName, number>> = {
  'Archivo-Regular': archivoRegular,
  'Archivo-Medium': archivoMedium,
  'Archivo-SemiBold': archivoSemiBold,
  'ArchivoCondensed-Bold': archivoCondensedBold,
  'ArchivoCondensed-ExtraBold': archivoCondensedExtraBold,
};
