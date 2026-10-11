@file:Suppress("MatchingDeclarationName")

package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.LightCeteleColors
import app.cetele.android.core.designsystem.R

enum class ButtonStyle {
    /** Defter Lacivert fill: the main step of a form or flow. */
    Primary,

    /** Çentik Turuncu fill with a Mürekkep label: the one action that matters on a screen. */
    Accent,

    /** Kâğıt fill on the ledger cover. */
    OnCover,

    /** Kâğıt fill on the stone page, for secondary actions next to a cover. */
    Quiet,
    Tonal,
    Outlined,
    Text,
}

@Composable
fun CeteleButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    style: ButtonStyle = ButtonStyle.Primary,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: Painter? = null,
) {
    val loadingText = stringResource(R.string.designsystem_button_loading)
    val height = if (style == ButtonStyle.Text) CeteleSpacing.touchTarget else CeteleSpacing.buttonHeight
    val target =
        modifier.heightIn(min = height).semantics {
            if (loading) {
                contentDescription = text
                stateDescription = loadingText
            }
        }
    val shape = MaterialTheme.shapes.small
    val padding = PaddingValues(horizontal = CeteleSpacing.large, vertical = CeteleSpacing.small)
    val content: @Composable RowScope.() -> Unit = { ButtonContent(text, loading, icon) }
    when (style) {
        ButtonStyle.Primary, ButtonStyle.Accent, ButtonStyle.OnCover, ButtonStyle.Quiet, ButtonStyle.Tonal -> {
            Button(
                onClick = onClick,
                modifier = target,
                enabled = enabled && !loading,
                shape = shape,
                colors = filledColors(style),
                contentPadding = padding,
                content = content,
            )
        }

        ButtonStyle.Outlined -> {
            OutlinedButton(
                onClick = onClick,
                modifier = target,
                enabled = enabled && !loading,
                shape = shape,
                border =
                    BorderStroke(
                        CeteleSpacing.hairline,
                        if (enabled) CeteleTheme.colors.borderStrong else CeteleTheme.colors.border,
                    ),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = CeteleTheme.colors.primaryText),
                contentPadding = padding,
                content = content,
            )
        }

        ButtonStyle.Text -> {
            TextButton(
                onClick = onClick,
                modifier = target,
                enabled = enabled && !loading,
                shape = shape,
                colors = ButtonDefaults.textButtonColors(contentColor = CeteleTheme.colors.primaryText),
                contentPadding = PaddingValues(horizontal = CeteleSpacing.none, vertical = CeteleSpacing.small),
                content = content,
            )
        }
    }
}

/** The same button with a line icon from [app.cetele.android.core.designsystem.CeteleIcons]. */
@Composable
fun CeteleButton(
    text: String,
    onClick: () -> Unit,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    style: ButtonStyle = ButtonStyle.Primary,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    CeteleButton(text, onClick, modifier, style, enabled, loading, rememberVectorPainter(icon))
}

@Composable
private fun filledColors(style: ButtonStyle): ButtonColors {
    val colors = CeteleTheme.colors
    val cover = CeteleTheme.cover
    val (container, content) =
        when (style) {
            ButtonStyle.Accent -> colors.accent to colors.onAccent
            ButtonStyle.OnCover -> cover.content to LIGHT_PRIMARY_ON_COVER
            ButtonStyle.Quiet -> colors.surface to colors.primaryText
            ButtonStyle.Tonal -> colors.secondary to colors.onSecondary
            else -> colors.primary to colors.onPrimary
        }
    return ButtonDefaults.buttonColors(
        containerColor = container,
        contentColor = content,
        disabledContainerColor = colors.surfaceSunken,
        disabledContentColor = colors.textMuted,
    )
}

/** Defter Lacivert: the label colour on the Kâğıt cover button in both schemes (12.8:1). */
private val LIGHT_PRIMARY_ON_COVER = LightCeteleColors.primary

@Composable
private fun ButtonContent(
    text: String,
    loading: Boolean,
    icon: Painter?,
) {
    if (loading) {
        CircularProgressIndicator(
            modifier = Modifier.size(CeteleSpacing.extraLarge),
            color = LocalContentColor.current,
            strokeWidth = CeteleSpacing.hairline * 2,
        )
    } else {
        // With large text the label needs the whole width; the icon only repeats it.
        if (icon != null && LocalDensity.current.fontScale <= ICON_FONT_SCALE_LIMIT) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(CeteleSpacing.large))
            Spacer(Modifier.width(CeteleSpacing.small))
        }
        Text(text, style = CeteleTextStyles.label, textAlign = TextAlign.Center)
    }
}

private const val ICON_FONT_SCALE_LIMIT = 1.15f
