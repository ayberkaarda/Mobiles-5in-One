package app.cetele.android.core.designsystem

import kotlinx.serialization.json.float
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class CeteleMotionTokenTest {
    @Test
    fun `durations equal every brand token`() {
        val tokens = BrandTokens.obj("motion", "duration")
        assertEquals(tokens.keys, CeteleMotion.durations.keys)
        tokens.forEach { (key, value) ->
            assertEquals(value.jsonPrimitive.int, CeteleMotion.durations.getValue(key), key)
        }
    }

    @Test
    fun `easings equal every brand token and retain endpoints`() {
        val tokens = BrandTokens.obj("motion", "easing")
        assertEquals(tokens.keys, CeteleMotion.easingPoints.keys)
        tokens.forEach { (key, value) ->
            assertEquals(value.jsonArray.map { it.jsonPrimitive.float }, CeteleMotion.easingPoints.getValue(key), key)
        }
        listOf(CeteleMotion.standard, CeteleMotion.emphasizedDecelerate, CeteleMotion.emphasizedAccelerate).forEach {
            assertEquals(0f, it.transform(0f))
            assertEquals(1f, it.transform(1f))
        }
    }

    @Test
    fun `reduced motion removes all durations`() {
        CeteleMotion.durations.values.forEach {
            assertEquals(0, CeteleMotion.duration(it, reducedMotion = true))
            assertEquals(it, CeteleMotion.duration(it, reducedMotion = false))
        }
    }
}
