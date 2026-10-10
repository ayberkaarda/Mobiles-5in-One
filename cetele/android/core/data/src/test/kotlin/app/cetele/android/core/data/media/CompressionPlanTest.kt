package app.cetele.android.core.data.media

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CompressionPlanTest {
    @Test fun sizeAndQualityLadder() {
        val steps = CompressionPlan.steps(4000, 2000, 3000000)
        assertEquals(listOf(85, 75, 65), steps.map { it.quality })
        assertTrue(steps.all { it.scale == 0.4f })
        assertTrue(CompressionPlan.steps(800, 600, 1000).all { it.scale == 1f })
        assertThrows(IllegalArgumentException::class.java) { CompressionPlan.steps(0, 1, 1) }
    }
}
