package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.cetele.android.core.designsystem.CeteleSpacing
import app.cetele.android.core.designsystem.R

private val digitRows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"))

@Composable
internal fun DigitKeypad(
    decimal: Boolean,
    enabled: Boolean,
    onKey: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val rows = digitRows + listOf(listOf(if (decimal) "," else "", "0", AmountInput.BACKSPACE))
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(CeteleSpacing.extraSmall)) {
        rows.forEach { keys ->
            Row(horizontalArrangement = Arrangement.spacedBy(CeteleSpacing.small)) {
                keys.forEach { key ->
                    if (key.isEmpty()) {
                        Spacer(Modifier.weight(1f))
                    } else {
                        val description =
                            when (key) {
                                AmountInput.BACKSPACE -> stringResource(R.string.designsystem_keypad_backspace)
                                "," -> stringResource(R.string.designsystem_keypad_decimal)
                                else -> key
                            }
                        TextButton(
                            onClick = { onKey(key) },
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .heightIn(min = CeteleSpacing.touchTarget)
                                    .semantics { contentDescription = description },
                            enabled = enabled,
                        ) {
                            Text(if (key == AmountInput.BACKSPACE) "⌫" else key)
                        }
                    }
                }
            }
        }
    }
}
