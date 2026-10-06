package app.cetele.android.core.designsystem

import androidx.compose.ui.text.AnnotatedString
import app.cetele.android.core.designsystem.component.PhoneVisualTransformation
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PhoneVisualTransformationTest {
    @Test
    fun `accepted phone forms display the same national grouping`() {
        listOf("05321234567", "5321234567", "+905321234567").forEach {
            assertEquals("0 532 123 45 67", PhoneVisualTransformation().filter(AnnotatedString(it)).text.text)
        }
    }

    @Test
    fun `cursor offsets remain bounded and monotonic for partial inputs`() {
        listOf("", "0", "05", "0532", "5", "5321234", "+", "+9", "+90", "+905321234567").forEach { raw ->
            val transformed = PhoneVisualTransformation().filter(AnnotatedString(raw))
            val display = transformed.text.text
            val forward = (0..raw.length).map(transformed.offsetMapping::originalToTransformed)
            val backward = (0..display.length).map(transformed.offsetMapping::transformedToOriginal)
            assertTrue(forward.all { it in 0..display.length }, raw)
            assertTrue(backward.all { it in 0..raw.length }, raw)
            assertTrue(forward.zipWithNext().all { (left, right) -> left <= right }, raw)
            assertTrue(backward.zipWithNext().all { (left, right) -> left <= right }, raw)
            assertEquals(display.length, forward.last(), raw)
            assertEquals(raw.length, backward.last(), raw)
        }
    }
}
