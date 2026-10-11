package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.designsystem.isCompactHeight
import app.cetele.android.core.domain.validation.Limits

@Composable
fun PinPad(
    onComplete: (String) -> Unit,
    modifier: Modifier = Modifier,
    length: Int = Limits.PIN_LENGTH,
    error: String? = null,
    subtitle: String? = null,
    enabled: Boolean = true,
    resetKey: Any? = error,
) {
    require(length > 0) { "PIN length must be positive" }
    // Kept only in composition memory. Changing resetKey starts a fresh attempt.
    var digits by remember(resetKey, length) { mutableStateOf("") }
    val progress = stringResource(R.string.designsystem_pin_progress, digits.length, length)
    val colors = CeteleTheme.colors
    val compact = isCompactHeight()
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(if (compact) CeteleSpacing.small else CeteleSpacing.regular),
    ) {
        if (subtitle != null) {
            Text(subtitle, style = CeteleTextStyles.body, color = colors.textMuted, textAlign = TextAlign.Center)
        }
        PinDots(length, digits.length, error != null, progress)
        if (error != null) {
            Text(
                text = error,
                modifier =
                    Modifier.semantics {
                        this.error(error)
                        liveRegion = LiveRegionMode.Polite
                    },
                style = CeteleTextStyles.bodyStrong,
                color = colors.errorText,
                textAlign = TextAlign.Center,
            )
        }
        DigitKeypad(
            decimal = false,
            enabled = enabled,
            modifier = Modifier.padding(top = if (compact) CeteleSpacing.none else CeteleSpacing.small),
            onKey = { key ->
                if (key == AmountInput.BACKSPACE) {
                    digits = digits.dropLast(1)
                } else if (digits.length < length) {
                    digits += key
                    if (digits.length == length) onComplete(digits)
                }
            },
        )
    }
}

/** One dot per digit: filled Defter Lacivert as digits come in, red after a wrong PIN; read out as progress. */
@Composable
private fun PinDots(
    length: Int,
    entered: Int,
    wrong: Boolean,
    progress: String,
) {
    val colors = CeteleTheme.colors
    Row(
        modifier =
            Modifier.padding(vertical = CeteleSpacing.small).clearAndSetSemantics {
                contentDescription = progress
            },
        horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.regular),
    ) {
        repeat(length) { index ->
            val dot = Modifier.size(CeteleSpacing.pinDot).clip(CircleShape)
            Box(
                if (index < entered) {
                    dot.background(if (wrong) colors.error else colors.primary)
                } else {
                    dot.border(CeteleSpacing.hairline * 2, colors.borderStrong, CircleShape)
                },
            )
        }
    }
}
