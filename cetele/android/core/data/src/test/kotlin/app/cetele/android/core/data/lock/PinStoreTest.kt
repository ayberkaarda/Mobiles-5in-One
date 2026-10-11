package app.cetele.android.core.data.lock

import app.cetele.android.core.data.vault.InMemoryVault
import app.cetele.android.core.data.vault.VaultKeys
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneId

class MutableClock(
    var now: Long = 0,
) : Clock() {
    override fun getZone(): ZoneId = ZoneId.of("UTC")

    override fun withZone(zone: ZoneId): Clock = this

    override fun instant(): Instant = Instant.ofEpochMilli(now)
}

class MutableElapsedClock(
    var now: Long = 0,
    var boot: Long = 1,
) : ElapsedClock {
    override fun millis(): Long = now

    override fun bootCount(): Long = boot
}

class PinStoreTest {
    @Test fun delaySurvivesRestartDoublesAndCaps() {
        val vault = InMemoryVault()
        val clock = MutableClock()
        val elapsed = MutableElapsedClock()
        val store = PinStore(vault, PinHasher(), clock, elapsed)
        store.set(CharArray(6) { '1' })
        repeat(4) { index -> assertEquals(PinVerdict.Wrong(4 - index), store.verify(CharArray(6) { '2' })) }
        assertEquals(PinVerdict.Delayed(30000), store.verify(CharArray(6) { '2' }))
        val restarted = PinStore(vault, PinHasher(), clock, elapsed)
        assertEquals(PinVerdict.Delayed(30000), restarted.verify(CharArray(6) { '1' }))
        clock.now = 30000
        elapsed.now = clock.now
        assertEquals(PinVerdict.Delayed(90000), restarted.verify(CharArray(6) { '2' }))
        clock.now = 90000
        elapsed.now = clock.now
        assertEquals(PinVerdict.Delayed(210000), restarted.verify(CharArray(6) { '2' }))
        clock.now = 210000
        elapsed.now = clock.now
        assertEquals(PinVerdict.Delayed(450000), restarted.verify(CharArray(6) { '2' }))
        clock.now = 450000
        elapsed.now = clock.now
        assertEquals(PinVerdict.Delayed(750000), restarted.verify(CharArray(6) { '2' }))
        clock.now = 750000
        elapsed.now = clock.now
        assertEquals(PinVerdict.Ok, restarted.verify(CharArray(6) { '1' }))
        assertEquals(PinVerdict.Wrong(4), restarted.verify(CharArray(6) { '2' }))
        assertTrue(restarted.isSet())
        restarted.clear()
        assertFalse(restarted.isSet())
        assertFalse(vault.keys().contains(VaultKeys.PIN_DELAY_UNTIL))
    }

    @Test fun wallClockChangesCannotFinishDelay() {
        val wall = MutableClock()
        val elapsed = MutableElapsedClock()
        val store = PinStore(InMemoryVault(), PinHasher(), wall, elapsed)
        store.set(CharArray(6) { '1' })
        repeat(5) { store.verify(CharArray(6) { '2' }) }
        wall.now = 86400000
        assertEquals(PinVerdict.Delayed(86430000), store.verify(CharArray(6) { '1' }))
        wall.now = -86400000
        assertEquals(PinVerdict.Delayed(-86370000), store.verify(CharArray(6) { '1' }))
        elapsed.now = 30000
        assertEquals(PinVerdict.Ok, store.verify(CharArray(6) { '1' }))
    }

    @Test fun rebootAndElapsedRollbackRestartFullDelay() {
        val vault = InMemoryVault()
        val wall = MutableClock()
        val elapsed = MutableElapsedClock(100000)
        val store = PinStore(vault, PinHasher(), wall, elapsed)
        store.set(CharArray(6) { '1' })
        repeat(5) { store.verify(CharArray(6) { '2' }) }
        elapsed.boot++
        elapsed.now = 200000
        val reopened = PinStore(vault, PinHasher(), wall, elapsed)
        assertEquals(PinVerdict.Delayed(30000), reopened.verify(CharArray(6) { '1' }))
        elapsed.now = 199999
        assertEquals(PinVerdict.Delayed(30000), reopened.verify(CharArray(6) { '1' }))
        elapsed.now = 229998
        assertEquals(PinVerdict.Delayed(1), reopened.verify(CharArray(6) { '1' }))
        elapsed.now++
        assertEquals(PinVerdict.Ok, reopened.verify(CharArray(6) { '1' }))
    }

    @Test fun legacyDelayCannotBeSkippedByWallClock() {
        val vault = InMemoryVault()
        val elapsed = MutableElapsedClock()
        val store = PinStore(vault, PinHasher(), MutableClock(86400000), elapsed)
        store.set(CharArray(6) { '1' })
        vault.put(VaultKeys.PIN_DELAY_UNTIL, "30000".toByteArray())
        vault.put(VaultKeys.PIN_FAILURES, "5".toByteArray())
        assertEquals(PinVerdict.Delayed(86430000), store.verify(CharArray(6) { '1' }))
        elapsed.now = 30000
        assertEquals(PinVerdict.Ok, store.verify(CharArray(6) { '1' }))
    }

    @Test fun unknownBootCountKeepsDelayLocked() {
        val wall = MutableClock()
        val elapsed = MutableElapsedClock(boot = -1)
        val store = PinStore(InMemoryVault(), PinHasher(), wall, elapsed)
        store.set(CharArray(6) { '1' })
        repeat(5) { store.verify(CharArray(6) { '2' }) }
        elapsed.now = 86400000
        assertEquals(PinVerdict.Delayed(30000), store.verify(CharArray(6) { '1' }))
        elapsed.boot = 2
        assertEquals(PinVerdict.Delayed(30000), store.verify(CharArray(6) { '1' }))
        elapsed.now += 30000
        assertEquals(PinVerdict.Ok, store.verify(CharArray(6) { '1' }))
    }
}
