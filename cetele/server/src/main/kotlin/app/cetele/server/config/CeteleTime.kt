package app.cetele.server.config

import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId

object CeteleTime {
    val ZONE: ZoneId = ZoneId.of("Europe/Istanbul")

    fun today(clock: Clock): LocalDate = LocalDate.now(clock.withZone(ZONE))

    fun monthStart(clock: Clock): LocalDate = today(clock).withDayOfMonth(1)
}
