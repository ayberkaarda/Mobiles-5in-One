package app.cetele.android.quality

import io.gitlab.arturbosch.detekt.test.lint
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class MonetaryDoubleTest {
    @Test
    fun `monetary Double declarations and inferred literals are rejected`() {
        assertEquals(1, MonetaryDouble().lint("val amount: Double = 1.0").size)
        assertEquals(1, MonetaryDouble().lint("fun save(balance: Double) = Unit").size)
        assertEquals(1, MonetaryDouble().lint("fun balance(): Double = 1.0").size)
        assertEquals(1, MonetaryDouble().lint("val payment = 1.25").size)
        assertEquals(1, MonetaryDouble().lint("val debt: Float = 1.0f").size)
    }

    @Test
    fun `minor unit Long values and nonmonetary coordinates are accepted`() {
        assertEquals(0, MonetaryDouble().lint("val amountMinor: Long = 125L").size)
        assertEquals(0, MonetaryDouble().lint("val latitude: Double = 1.0").size)
    }
}
