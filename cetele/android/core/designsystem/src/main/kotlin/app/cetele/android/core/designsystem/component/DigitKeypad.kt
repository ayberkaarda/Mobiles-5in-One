package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.designsystem.CeteleIcons
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.CeteleTextStyles
import app.cetele.android.core.designsystem.CeteleTheme
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.designsystem.isCompactHeight

private val digitRows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"))

/** Large paper keys on the stone page, sized for a thumb behind the counter. */
@Composable
internal fun DigitKeypad(
    decimal: Boolean,
    enabled: Boolean,
    onKey: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val rows = digitRows + listOf(listOf(if (decimal) "," else "", "0", AmountInput.BACKSPACE))
    val compact = isCompactHeight()
    val gap = if (compact) CeteleSpacing.extraSmall else CeteleSpacing.small
    val keyHeight = if (compact) CeteleSpacing.touchTarget else CeteleSpacing.keyHeight
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap)) {
        rows.forEach { keys ->
            Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                keys.forEach { key ->
                    if (key.isEmpty()) {
                        Spacer(Modifier.weight(1f))
                    } else {
                        DigitKey(key, enabled, onKey, Modifier.weight(1f).heightIn(min = keyHeight))
                    }
                }
            }
        }
    }
}

@Composable
private fun DigitKey(
    key: String,
    enabled: Boolean,
    onKey: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = CeteleTheme.colors
    val description =
        when (key) {
            AmountInput.BACKSPACE -> stringResource(R.string.designsystem_keypad_backspace)
            "," -> stringResource(R.string.designsystem_keypad_decimal)
            else -> key
        }
    val backspace = key == AmountInput.BACKSPACE
    Surface(
        onClick = { onKey(key) },
        modifier =
            modifier.semantics {
                contentDescription = description
                role = Role.Button
            },
        enabled = enabled,
        shape = MaterialTheme.shapes.medium,
        color = if (backspace) colors.background else colors.surface,
        contentColor = if (enabled) colors.text else colors.textMuted,
    ) {
        Box(contentAlignment = Alignment.Center) {
            if (backspace) {
                Icon(CeteleIcons.backspace, contentDescription = null)
            } else {
                Text(key, style = CeteleTextStyles.headline)
            }
        }
    }
}
