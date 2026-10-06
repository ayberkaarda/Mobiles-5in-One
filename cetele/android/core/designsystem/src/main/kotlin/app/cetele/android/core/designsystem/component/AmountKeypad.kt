@file:Suppress("MatchingDeclarationName")

package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import app.cetele.android.core.domain.format.MoneyFormat

/** Holds incomplete decimal input separately from its integer minor-unit value. */
internal class AmountInput(
    initial: Long,
) {
    var text: String = editableAmount(initial)
        private set

    fun synchronize(value: Long) {
        if (minor() != value) text = editableAmount(value)
    }

    fun press(key: String): Long? {
        val parsed = nextText(key)?.let { candidate -> parseIncomplete(candidate)?.also { text = candidate } }
        return parsed
    }

    private fun nextText(key: String): String? =
        when {
            key == BACKSPACE -> text.dropLast(1)
            key == "," -> if (',' in text) null else text.ifEmpty { "0" } + ","
            key.length == 1 && key[0] in '0'..'9' -> text + key
            else -> null
        }

    fun minor(): Long = requireNotNull(parseIncomplete(text))

    private fun parseIncomplete(value: String): Long? =
        if (value.isEmpty()) 0L else MoneyFormat.parse(value.removeSuffix(","))

    private fun editableAmount(value: Long): String {
        require(value >= 0) { "Amount must be non-negative" }
        return if (value == 0L) "" else MoneyFormat.format(value).removePrefix("₺").replace(".", "")
    }

    companion object {
        const val BACKSPACE = "backspace"
    }
}

@Composable
fun AmountKeypad(
    value: Long,
    onChange: (Long) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val input = remember { AmountInput(value) }
    var draft by remember { mutableStateOf(input.text) }
    LaunchedEffect(value) {
        input.synchronize(value)
        draft = input.text
    }
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = draft.ifEmpty { "0" },
            style = app.cetele.android.core.designsystem.CeteleTextStyles.amount,
        )
        DigitKeypad(
            decimal = true,
            enabled = enabled,
            onKey = { key ->
                input.press(key)?.let { minor ->
                    draft = input.text
                    onChange(minor)
                }
            },
        )
    }
}
