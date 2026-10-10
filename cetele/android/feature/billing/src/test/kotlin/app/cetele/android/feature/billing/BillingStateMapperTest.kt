package app.cetele.android.feature.billing

import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.network.dto.billing.SubscriptionState
import app.cetele.android.feature.billing.data.BillingStateMapper
import app.cetele.android.feature.billing.data.SubscriptionStatus
import app.cetele.android.feature.billing.data.Usage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import java.time.Instant
import java.time.YearMonth

class BillingStateMapperTest {
    @Test
    fun `free shop without subscription keeps its limits and usage`() {
        val overview = BillingStateMapper.map(freeState())
        assertEquals(ShopPlan.FREE, overview.plan)
        assertEquals(YearMonth.of(2026, 10), overview.month)
        assertEquals(Usage(42, 100), overview.customers)
        assertEquals(Usage(7, 200), overview.photos)
        assertEquals(Usage(3, 30), overview.sms)
        assertNull(overview.subscription)
        assertFalse(overview.entitled)
        assertFalse(overview.customers.unlimited)
    }

    @Test
    fun `null customers limit is unlimited`() {
        val overview = BillingStateMapper.map(proState())
        assertEquals(ShopPlan.PRO, overview.plan)
        assertTrue(overview.customers.unlimited)
        assertEquals(Usage(137, null), overview.customers)
        assertEquals(Usage(12, 2000), overview.photos)
        assertEquals(Usage(3, 500), overview.sms)
    }

    @ParameterizedTest
    @CsvSource(
        "PENDING, PENDING, false",
        "ACTIVE, ACTIVE, true",
        "IN_GRACE_PERIOD, GRACE, true",
        "ON_HOLD, ON_HOLD, false",
        "PAUSED, PAUSED, false",
        "CANCELED, CANCELED, true",
        "EXPIRED, EXPIRED, false",
        "REVOKED, REVOKED, false",
        "REPLACED, ENDED, false",
        "ORPHANED, ENDED, false",
    )
    fun `every stored state maps to a screen status and keeps the server entitlement`(
        state: SubscriptionState,
        status: SubscriptionStatus,
        entitled: Boolean,
    ) {
        val overview = BillingStateMapper.map(proState(subscription(state, entitled, "yearly")))
        val summary = checkNotNull(overview.subscription)
        assertEquals(status, summary.status)
        assertEquals(entitled, summary.entitled)
        assertEquals(entitled, overview.entitled)
        assertEquals("yearly", summary.basePlanId)
        assertTrue(summary.testPurchase)
        if (state == SubscriptionState.PENDING) {
            assertNull(summary.expiresAt)
        } else {
            assertEquals(Instant.parse("2026-11-11T09:30:00Z"), summary.expiresAt)
        }
    }

    @Test
    fun `every wire state is covered`() {
        assertEquals(SubscriptionState.entries.size, SubscriptionState.entries.map(BillingStateMapper::status).size)
        assertEquals(
            SubscriptionStatus.entries.toSet(),
            SubscriptionState.entries.map(BillingStateMapper::status).toSet(),
        )
    }

    @Test
    fun `malformed month is dropped instead of failing the screen`() {
        val state = freeState().copy(usage = freeState().usage.copy(month = "2026-13"))
        assertNull(BillingStateMapper.map(state).month)
    }
}
