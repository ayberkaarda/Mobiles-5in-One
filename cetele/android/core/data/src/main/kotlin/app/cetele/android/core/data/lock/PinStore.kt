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
class PinStore
    @Inject
    constructor(
        private val vault: Vault,
        private val hasher: PinHasher,
        private val clock: Clock,
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
            val until = number(VaultKeys.PIN_DELAY_UNTIL)
            return when {
                clock.millis() < until -> PinVerdict.Delayed(until)
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
            val level = (failures - FAILURE_LIMIT).toInt().coerceAtMost(MAX_DELAY_LEVEL)
            val delay = (INITIAL_DELAY_MILLIS * (1L shl level)).coerceAtMost(MAX_DELAY_MILLIS)
            val next = Math.addExact(clock.millis(), delay)
            putNumber(VaultKeys.PIN_DELAY_UNTIL, next)
            return PinVerdict.Delayed(next)
        }

        fun clear() {
            vault.remove(VaultKeys.PIN_HASH)
            vault.remove(VaultKeys.PIN_SALT)
            resetFailures()
        }

        private fun resetFailures() {
            vault.remove(VaultKeys.PIN_FAILURES)
            vault.remove(VaultKeys.PIN_DELAY_UNTIL)
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
