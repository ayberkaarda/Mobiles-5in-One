package app.cetele.android.core.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

/** Brand roles that Material 3 has no slot for (debt, payment, accent text, focus ring and the rest). */
val LocalCeteleColors = staticCompositionLocalOf { LightCeteleColors }

/** Colours of the ledger cover in the current scheme. */
val LocalCoverColors = staticCompositionLocalOf { coverColors(dark = false) }

/** Material 3 mapping of the brand roles (table "Using the tokens on Android" in the brand README). */
fun CeteleColors.toColorScheme(dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        background = background,
        onBackground = text,
        surface = surface,
        onSurface = text,
        onSurfaceVariant = textMuted,
        surfaceContainer = surface,
        surfaceContainerLow = surface,
        surfaceContainerHigh = surfaceRaised,
        surfaceContainerHighest = surfaceRaised,
        surfaceBright = surface,
        surfaceDim = background,
        surfaceTint = primary,
        primaryContainer = secondary,
        onPrimaryContainer = onSecondary,
        secondary = primary,
        onSecondary = onPrimary,
        surfaceVariant = surfaceSunken,
        surfaceContainerLowest = surfaceSunken,
        primary = primary,
        onPrimary = onPrimary,
        secondaryContainer = secondary,
        onSecondaryContainer = onSecondary,
        tertiary = accent,
        onTertiary = onAccent,
        error = error,
        onError = onError,
        outline = borderStrong,
        outlineVariant = border,
        scrim = overlay,
    )
}

/** Application theme: brand colours (light and dark), type scale and shapes. */
@Composable
fun CeteleTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkCeteleColors else LightCeteleColors
    CompositionLocalProvider(LocalCeteleColors provides colors, LocalCoverColors provides coverColors(darkTheme)) {
        MaterialTheme(
            colorScheme = colors.toColorScheme(darkTheme),
            typography = CeteleTypography,
            shapes = CeteleShapes,
            content = content,
        )
    }
}

/** Access to the extended brand roles inside [CeteleTheme]. */
object CeteleTheme {
    val colors: CeteleColors
        @Composable
        @ReadOnlyComposable
        get() = LocalCeteleColors.current

    val cover: CoverColors
        @Composable
        @ReadOnlyComposable
        get() = LocalCoverColors.current
}
