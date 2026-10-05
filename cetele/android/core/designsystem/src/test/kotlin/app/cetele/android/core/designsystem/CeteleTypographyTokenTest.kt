package app.cetele.android.core.designsystem

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.float
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class CeteleTypographyTokenTest {
    private val styles: Map<String, TextStyle> =
        mapOf(
            "display" to CeteleTextStyles.display,
            "headline" to CeteleTextStyles.headline,
            "title" to CeteleTextStyles.title,
            "titleSmall" to CeteleTextStyles.titleSmall,
            "bodyLarge" to CeteleTextStyles.bodyLarge,
            "body" to CeteleTextStyles.body,
            "bodyStrong" to CeteleTextStyles.bodyStrong,
            "label" to CeteleTextStyles.label,
            "caption" to CeteleTextStyles.caption,
            "amount" to CeteleTextStyles.amount,
            "amountLarge" to CeteleTextStyles.amountLarge,
        )

    @Test
    fun `every token style has a matching text style`() {
        assertEquals(BrandTokens.obj("typography", "scale").keys, styles.keys)
    }

    @Test
    fun `sizes, weights, families and features equal the brand tokens`() {
        BrandTokens.obj("typography", "scale").forEach { (name, element) ->
            val token = element.jsonObject
            val style = styles.getValue(name)
            val app = token.getValue("app").jsonObject
            val family = if (token.string("family") == "display") Manrope else Inter
            val features = token["features"]?.jsonArray?.joinToString(",") { it.jsonPrimitive.content }
            val size = app.getValue("size").jsonPrimitive.int
            val lineHeight = app.getValue("lineHeight").jsonPrimitive.int
            val tracking = token.getValue("tracking").jsonPrimitive.float

            assertEquals(size.toFloat(), style.fontSize.value, "$name size")
            assertEquals(lineHeight.toFloat(), style.lineHeight.value, "$name line height")
            assertEquals(FontWeight(token.getValue("weight").jsonPrimitive.int), style.fontWeight, "$name weight")
            assertEquals(family, style.fontFamily, "$name family")
            assertEquals(features, style.fontFeatureSettings, "$name features")
            assertEquals(tracking, style.letterSpacing.value, TOLERANCE, "$name tracking")
        }
    }

    private fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content

    private companion object {
        const val TOLERANCE = 0.000_001f
    }
}
