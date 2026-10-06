package app.cetele.android.core.designsystem

import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class CeteleSpacingTokenTest {
    @Test
    fun `spacing scale equals every brand token`() {
        val tokens = BrandTokens.obj("spacing")
        assertEquals(tokens.keys, CeteleSpacing.scale.keys)
        tokens.forEach { (key, value) ->
            assertEquals(value.jsonPrimitive.int.toFloat(), CeteleSpacing.scale.getValue(key).value, key)
        }
    }

    @Test
    fun `layout and interaction minimums match the contract`() {
        assertEquals(16f, CeteleSpacing.screenGutter.value)
        assertEquals(64f, CeteleSpacing.rowMinHeight.value)
        assertEquals(48f, CeteleSpacing.touchTarget.value)
        assertEquals(56f, CeteleSpacing.fabSize.value)
    }
}
