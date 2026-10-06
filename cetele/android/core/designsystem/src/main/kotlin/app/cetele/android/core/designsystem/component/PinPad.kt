package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R
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
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(CeteleSpacing.regular)) {
        if (subtitle != null) Text(subtitle, style = CeteleTextStyles.body)
        Row(
            modifier = Modifier.clearAndSetSemantics { contentDescription = progress },
            horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small),
        ) {
            repeat(length) { index -> Text(if (index < digits.length) "●" else "○", style = CeteleTextStyles.title) }
        }
        if (error != null) {
            Text(
                text = error,
                modifier =
                    Modifier.semantics {
                        this.error(error)
                        liveRegion = LiveRegionMode.Polite
                    },
                color = CeteleTheme.colors.errorText,
            )
        }
        DigitKeypad(decimal = false, enabled = enabled, onKey = { key ->
            if (key == AmountInput.BACKSPACE) {
                digits = digits.dropLast(1)
            } else if (digits.length < length) {
                digits += key
                if (digits.length == length) onComplete(digits)
            }
        })
    }
}
