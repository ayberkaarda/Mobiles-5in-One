package app.cetele.android.core.domain

import app.cetele.android.core.domain.id.UuidV7
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.Random
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors

class UuidV7Test {
    @Test
    fun `version variant canonical text and timestamp match UUID seven`() {
        val instant = Instant.parse("2026-10-06T10:00:00Z")
        val id = UuidV7.generate(Clock.fixed(instant, ZoneOffset.UTC), Random(7))
        val uuid = UUID.fromString(id)
        assertEquals(7, uuid.version())
        assertEquals(2, uuid.variant())
        assertEquals(instant.toEpochMilli(), uuid.mostSignificantBits ushr 16)
        assertTrue(Regex("[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}").matches(id))
    }

    @Test
    fun `ten thousand ids within a millisecond are unique and increasing`() {
        val clock = Clock.fixed(Instant.parse("2026-10-06T11:00:00Z"), ZoneOffset.UTC)
        val random = Random(11)
        val ids = List(10_000) { UuidV7.generate(clock, random) }
        assertEquals(10_000, ids.toSet().size)
        assertTrue(ids.zipWithNext().all { (a, b) -> a < b })
    }

    @Test
    fun `timestamp order dominates random bits across milliseconds`() {
        val instant = Instant.parse("2026-10-06T12:00:00Z")
        val first = UuidV7.generate(Clock.fixed(instant, ZoneOffset.UTC), Random(99))
        val second = UuidV7.generate(Clock.fixed(instant.plusMillis(1), ZoneOffset.UTC), Random(1))
        assertTrue(first < second)
    }

    @Test
    fun `random tail carry preserves version variant and ordering`() {
        val clock = Clock.fixed(Instant.parse("2026-10-06T13:00:00Z"), ZoneOffset.UTC)
        val random =
            object : Random() {
                override fun nextLong(): Long = -1L
            }
        val first = UuidV7.generate(clock, random)
        val second = UuidV7.generate(clock, random)
        val third = UuidV7.generate(clock, random)
        assertTrue(first < second)
        assertTrue(second < third)
        assertEquals(7, UUID.fromString(second).version())
        assertEquals(2, UUID.fromString(second).variant())
    }

    @Test
    fun `concurrent callers never share an id`() {
        val clock = Clock.fixed(Instant.parse("2026-10-06T14:00:00Z"), ZoneOffset.UTC)
        val pool = Executors.newFixedThreadPool(4)
        try {
            val results = pool.invokeAll(List(1000) { Callable { UuidV7.generate(clock) } }).map { it.get() }
            assertEquals(1000, results.toSet().size)
        } finally {
            pool.shutdownNow()
        }
    }
}
