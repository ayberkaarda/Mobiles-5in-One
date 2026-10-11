package app.cetele.android.core.data.lock

import app.cetele.android.core.data.vault.Vault
import app.cetele.android.core.data.vault.VaultKeys
import app.cetele.android.core.domain.validation.Limits
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton

sealed interface PinVerdict {
    data object Ok : PinVerdict

    data class Wrong(
        val remainingBeforeDelay: Int,
    ) : PinVerdict

    data class Delayed(
        val untilMillis: Long,
    ) : PinVerdict
}

@Singleton
@Suppress("TooManyFunctions")
class PinStore
    @Inject
    constructor(
        private val vault: Vault,
        private val hasher: PinHasher,
        private val clock: Clock,
        private val elapsed: ElapsedClock,
    ) {
        fun isSet(): Boolean = vault.get(VaultKeys.PIN_HASH) != null

        @Synchronized fun set(pin: CharArray) {
            val salt = ByteArray(PinHasher.SALT_BYTES).also { SecureRandom().nextBytes(it) }
            val hash = hasher.hash(pin, salt)
            vault.put(VaultKeys.PIN_SALT, salt)
            vault.put(VaultKeys.PIN_HASH, hash)
            resetFailures()
        }

        @Synchronized fun verify(pin: CharArray): PinVerdict {
            val remaining = remainingDelay()
            return when {
                remaining > 0 -> PinVerdict.Delayed(Math.addExact(clock.millis(), remaining))
                matches(pin) -> PinVerdict.Ok.also { resetFailures() }
                else -> recordFailure()
            }
        }

        private fun matches(pin: CharArray): Boolean {
            val salt = vault.get(VaultKeys.PIN_SALT)
            val expected = vault.get(VaultKeys.PIN_HASH)
            val validShape = pin.size == Limits.PIN_LENGTH && pin.all { it in '0'..'9' }
            if (salt == null || expected == null || !validShape) return false
            return MessageDigest.isEqual(expected, hasher.hash(pin, salt))
        }

        private fun recordFailure(): PinVerdict {
            val failures = (number(VaultKeys.PIN_FAILURES) + 1).coerceAtMost(MAX_FAILURES)
            putNumber(VaultKeys.PIN_FAILURES, failures)
            if (failures < FAILURE_LIMIT) return PinVerdict.Wrong(FAILURE_LIMIT - failures.toInt())
            val delay = delayFor(failures)
            startDelay(delay)
            return PinVerdict.Delayed(Math.addExact(clock.millis(), delay))
        }

        private fun delayFor(failures: Long): Long {
            val level = (failures - FAILURE_LIMIT).coerceIn(0, MAX_DELAY_LEVEL.toLong()).toInt()
            return (INITIAL_DELAY_MILLIS * (1L shl level)).coerceAtMost(MAX_DELAY_MILLIS)
        }

        private fun startDelay(delay: Long) {
            putNumber(VaultKeys.PIN_DELAY_MILLIS, delay)
            putNumber(VaultKeys.PIN_DELAY_ELAPSED, Math.addExact(elapsed.millis(), delay))
            putNumber(VaultKeys.PIN_DELAY_BOOT, elapsed.bootCount())
        }

        private fun remainingDelay(): Long {
            val delay = number(VaultKeys.PIN_DELAY_MILLIS)
            return if (delay <= 0) {
                migrateLegacyDelay()
            } else {
                val until = number(VaultKeys.PIN_DELAY_ELAPSED)
                val now = elapsed.millis()
                val boot = elapsed.bootCount()
                if (boot < 0 || number(VaultKeys.PIN_DELAY_BOOT) != boot || now < until - delay) {
                    startDelay(delay)
                    delay
                } else {
                    (until - now).coerceAtLeast(0)
                }
            }
        }

        private fun migrateLegacyDelay(): Long {
            if (vault.get(VaultKeys.PIN_DELAY_UNTIL) == null) return 0
            val delay = delayFor(number(VaultKeys.PIN_FAILURES))
            startDelay(delay)
            vault.remove(VaultKeys.PIN_DELAY_UNTIL)
            return delay
        }

        fun clear() {
            vault.remove(VaultKeys.PIN_HASH)
            vault.remove(VaultKeys.PIN_SALT)
            resetFailures()
        }

        private fun resetFailures() {
            vault.remove(VaultKeys.PIN_FAILURES)
            vault.remove(VaultKeys.PIN_DELAY_UNTIL)
            vault.remove(VaultKeys.PIN_DELAY_ELAPSED)
            vault.remove(VaultKeys.PIN_DELAY_MILLIS)
            vault.remove(VaultKeys.PIN_DELAY_BOOT)
        }

        private fun number(key: String): Long = vault.get(key)?.toString(Charsets.UTF_8)?.toLongOrNull() ?: 0

        private fun putNumber(
            key: String,
            value: Long,
        ) {
            vault.put(key, value.toString().toByteArray(Charsets.UTF_8))
        }

        private companion object {
            const val MAX_FAILURES = 100L
            const val MAX_DELAY_LEVEL = 4
            const val FAILURE_LIMIT = 5
            const val INITIAL_DELAY_MILLIS = 30000L
            const val MAX_DELAY_MILLIS = 300000L
        }
    }
