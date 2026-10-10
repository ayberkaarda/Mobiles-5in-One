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

class PinStoreTest {
    @Test fun delaySurvivesRestartDoublesAndCaps() {
        val vault = InMemoryVault()
        val clock = MutableClock()
        val store = PinStore(vault, PinHasher(), clock)
        store.set(CharArray(6) { '1' })
        repeat(4) { index -> assertEquals(PinVerdict.Wrong(4 - index), store.verify(CharArray(6) { '2' })) }
        assertEquals(PinVerdict.Delayed(30000), store.verify(CharArray(6) { '2' }))
        val restarted = PinStore(vault, PinHasher(), clock)
        assertEquals(PinVerdict.Delayed(30000), restarted.verify(CharArray(6) { '1' }))
        clock.now = 30000
        assertEquals(PinVerdict.Delayed(90000), restarted.verify(CharArray(6) { '2' }))
        clock.now = 90000
        assertEquals(PinVerdict.Delayed(210000), restarted.verify(CharArray(6) { '2' }))
        clock.now = 210000
        assertEquals(PinVerdict.Delayed(450000), restarted.verify(CharArray(6) { '2' }))
        clock.now = 450000
        assertEquals(PinVerdict.Delayed(750000), restarted.verify(CharArray(6) { '2' }))
        clock.now = 750000
        assertEquals(PinVerdict.Ok, restarted.verify(CharArray(6) { '1' }))
        assertEquals(PinVerdict.Wrong(4), restarted.verify(CharArray(6) { '2' }))
        assertTrue(restarted.isSet())
        restarted.clear()
        assertFalse(restarted.isSet())
        assertFalse(vault.keys().contains(VaultKeys.PIN_DELAY_UNTIL))
    }
}
