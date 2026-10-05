package app.cetele.android.core.designsystem

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val CeteleLightColors =
    lightColorScheme(
        primary = CetelePalette.DefterLacivert,
        onPrimary = CetelePalette.Kagit,
        secondary = CetelePalette.CentikTuruncu,
        onSecondary = CetelePalette.Murekkep,
        background = CetelePalette.Kagit,
        onBackground = CetelePalette.Murekkep,
        surface = CetelePalette.Kagit,
        onSurface = CetelePalette.Murekkep,
        onSurfaceVariant = CetelePalette.Kursun,
        error = CetelePalette.BorcKirmizisi,
        onError = CetelePalette.White,
    )

/** Application theme. Colour roles, typography and shapes follow the brand tokens. */
@Composable
fun CeteleTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = CeteleLightColors,
        content = content,
    )
}
