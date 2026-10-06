@file:Suppress("MatchingDeclarationName")

package app.cetele.android.core.designsystem.component

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import app.cetele.android.core.designsystem.R

/** Inserts spaces while retaining a cursor mapping for every partial phone number. */
class PhoneVisualTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val original = text.text
        val international = original.startsWith("+90")
        val prefixLength = if (international) COUNTRY_PREFIX_LENGTH else 0
        val national = if (international) "0" + original.drop(prefixLength) else original
        val hasZero = national.startsWith("0")
        val boundaries = if (hasZero) nationalBoundaries else mobileBoundaries
        val offsets = IntArray(original.length + 1)
        val display =
            buildString {
                if (!hasZero && national.isNotEmpty()) append("0 ")
                national.forEachIndexed { index, character ->
                    if (index in boundaries) append(' ')
                    val originalIndex = if (international) index + prefixLength - 1 else index
                    if (originalIndex in offsets.indices) offsets[originalIndex] = length
                    append(character)
                }
                offsets[original.length] = length
            }
        if (international) {
            repeat(prefixLength) { offsets[it] = 0 }
        }
        val mapping =
            object : OffsetMapping {
                override fun originalToTransformed(offset: Int): Int = offsets[offset.coerceIn(0, original.length)]

                override fun transformedToOriginal(offset: Int): Int =
                    offsets.indexOfLast { it <= offset.coerceIn(0, display.length) }.coerceAtLeast(0)
            }
        return TransformedText(AnnotatedString(display), mapping)
    }
}

@Composable
fun PhoneTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String = stringResource(R.string.designsystem_phone_label),
    error: String? = null,
    supporting: String? = null,
    enabled: Boolean = true,
) {
    CeteleTextField(
        value = value,
        onValueChange = { input ->
            val compact = input.filterIndexed { index, char -> char in '0'..'9' || (index == 0 && char == '+') }
            if (compact.length <= MAX_PHONE_LENGTH) onValueChange(compact)
        },
        label = label,
        modifier = modifier,
        error = error,
        keyboard = KeyboardOptions(keyboardType = KeyboardType.Phone),
        supporting = supporting,
        enabled = enabled,
        visualTransformation = PhoneVisualTransformation(),
    )
}

private const val MAX_PHONE_LENGTH = 13
private const val COUNTRY_PREFIX_LENGTH = 3
private val nationalBoundaries = setOf(1, 4, 7, 9)
private val mobileBoundaries = setOf(3, 6, 8)
