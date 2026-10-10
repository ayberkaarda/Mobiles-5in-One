package app.cetele.android.core.domain.time

import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

object CeteleClock {
    val ZONE: ZoneId = ZoneId.of("Europe/Istanbul")

    fun today(clock: Clock = Clock.systemUTC()): LocalDate = LocalDate.now(clock.withZone(ZONE))

    fun now(clock: Clock = Clock.systemUTC()): Instant = clock.instant()
}
