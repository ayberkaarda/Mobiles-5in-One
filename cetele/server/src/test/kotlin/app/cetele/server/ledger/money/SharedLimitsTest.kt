package app.cetele.server.ledger.money

import app.cetele.server.config.CeteleTime
import app.cetele.server.config.PublicUrlProperties
import app.cetele.server.config.SmsLimitsProperties
import app.cetele.server.tenancy.PlanLimits
import app.cetele.server.tenancy.shop.ShopPlan
import app.cetele.server.web.validation.Kurus
import jakarta.validation.Validation
import org.junit.jupiter.api.Test
import org.springframework.boot.context.properties.bind.Bindable
import org.springframework.boot.context.properties.bind.Binder
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class SharedLimitsTest {
    @Test
    fun `Istanbul day and month start at the local boundary`() {
        val clock = Clock.fixed(Instant.parse("2026-09-30T21:00:00Z"), ZoneOffset.UTC)
        assertEquals(LocalDate.of(2026, 10, 1), CeteleTime.today(clock))
        assertEquals(LocalDate.of(2026, 10, 1), CeteleTime.monthStart(clock))
    }

    @Test
    fun `plan quotas follow the contract`() {
        assertEquals(PlanLimits(100, 200, 30), PlanLimits.of(ShopPlan.FREE))
        assertEquals(PlanLimits(Int.MAX_VALUE, 2000, 500), PlanLimits.of(ShopPlan.PRO))
        assertEquals(1000, SmsLimitsProperties().dailyCap)
        assertFailsWith<IllegalArgumentException> { SmsLimitsProperties(0) }
    }

    @Test
    fun `public base URL binds from its exact property and rejects empty or trailing slash`() {
        val source = MapConfigurationPropertySource(mapOf("cetele.public-base-url" to "https://cetele.app"))
        val settings = Binder(source).bind("cetele", Bindable.of(PublicUrlProperties::class.java)).get()
        assertEquals("https://cetele.app", settings.baseUrl)
        assertFailsWith<IllegalArgumentException> { PublicUrlProperties("") }
        assertFailsWith<IllegalArgumentException> { PublicUrlProperties("https://cetele.app/") }
    }

    @Test
    fun `kurus reports the composed range error`() {
        Validation.buildDefaultValidatorFactory().use { factory ->
            val validator = factory.validator
            listOf(1L, 10_000_000_000L).forEach { assertTrue(validator.validate(Amount(it)).isEmpty()) }
            listOf(0L, 10_000_000_001L).forEach {
                assertEquals(listOf("out_of_range"), validator.validate(Amount(it)).map { violation -> violation.message })
            }
        }
    }

    private data class Amount(
        @field:Kurus val minor: Long,
    )
}
