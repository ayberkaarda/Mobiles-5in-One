package app.cetele.android.core.domain

import app.cetele.android.core.domain.time.CeteleClock
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneId

class CeteleClockTest {
    @Test
    fun `Istanbul day changes at twenty one UTC`() {
        val before = Clock.fixed(Instant.parse("2026-10-05T20:59:59Z"), ZoneId.of("America/New_York"))
        val after = Clock.fixed(Instant.parse("2026-10-05T21:00:00Z"), ZoneId.of("Asia/Tokyo"))
        assertEquals(today.minusDays(1), CeteleClock.today(before))
        assertEquals(today, CeteleClock.today(after))
        assertEquals(ZoneId.of("Europe/Istanbul"), CeteleClock.ZONE)
    }

    @Test
    fun `now returns clock instant without altering time zone`() {
        val instant = Instant.parse("2026-10-06T23:59:59Z")
        val clock = Clock.fixed(instant, ZoneId.of("Europe/London"))
        assertEquals(instant, CeteleClock.now(clock))
        assertEquals(today.plusDays(1), CeteleClock.today(clock))
    }
}
