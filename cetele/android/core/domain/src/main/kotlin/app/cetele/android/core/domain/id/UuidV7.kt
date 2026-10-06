package app.cetele.android.core.domain.id

import java.security.SecureRandom
import java.time.Clock
import java.util.Random
import java.util.UUID

object UuidV7 {
    private const val MAX_TIMESTAMP = 0xffffffffffffL
    private const val HIGH_MASK = 0xfffL
    private const val LOW_MASK = 0x3fffffffffffffffL
    private const val TIME_SHIFT = 16
    private const val VERSION = 0x7000L
    private val entropy = SecureRandom()
    private var lastObservedMillis = -1L
    private var lastMillis = -1L
    private var highTail = 0L
    private var lowTail = 0L

    @Synchronized
    fun generate(
        clock: Clock = Clock.systemUTC(),
        random: Random = entropy,
    ): String {
        val observedMillis = clock.millis()
        require(observedMillis in 0..MAX_TIMESTAMP) { "Timestamp outside UUID range" }
        var millis = observedMillis
        if (observedMillis == lastObservedMillis) {
            millis = lastMillis
            if (lowTail == LOW_MASK) {
                if (highTail == HIGH_MASK) {
                    require(millis < MAX_TIMESTAMP) { "UUID range exhausted" }
                    millis += 1
                    highTail = 0
                } else {
                    highTail += 1
                }
                lowTail = 0
            } else {
                lowTail += 1
            }
        } else {
            highTail = random.nextLong() and HIGH_MASK
            lowTail = random.nextLong() and LOW_MASK
        }
        lastObservedMillis = observedMillis
        lastMillis = millis
        val most = (millis shl TIME_SHIFT) or VERSION or highTail
        val least = Long.MIN_VALUE or lowTail
        return UUID(most, least).toString()
    }
}
