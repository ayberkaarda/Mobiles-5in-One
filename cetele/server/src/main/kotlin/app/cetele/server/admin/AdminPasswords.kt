package app.cetele.server.admin

import org.springframework.security.crypto.argon2.Argon2PasswordEncoder
import org.springframework.stereotype.Component
import java.security.SecureRandom

/**
 * Admin passwords: `Argon2PasswordEncoder(16, 32, 1, 65536, 3)` (spec item 11), 12 to 128
 * characters, no other composition rule. An unknown email is checked against [dummyHash], so both
 * paths cost one Argon2id verification.
 */
@Component
class AdminPasswords {
    private val encoder = Argon2PasswordEncoder(SALT_LENGTH, HASH_LENGTH, PARALLELISM, MEMORY_KIB, ITERATIONS)
    private val dummyHash: String = encoder.encode(randomPassword())!!
    private val random = SecureRandom()

    fun hash(password: String): String {
        require(isAcceptable(password)) { "password length out of range" }
        return encoder.encode(password)!!
    }

    /** Verifies [password] against [hash], or against the dummy hash when [hash] is `null`. */
    fun matches(
        password: String,
        hash: String?,
    ): Boolean {
        // Bounded input: an overlong value is verified against the dummy hash and never accepted.
        val candidate = if (password.length > MAX_LENGTH) password.take(MAX_LENGTH) else password
        val matched = encoder.matches(candidate, hash ?: dummyHash)
        return matched && hash != null && password.length <= MAX_LENGTH
    }

    fun isAcceptable(password: String): Boolean = password.length in MIN_LENGTH..MAX_LENGTH

    /** A one-time password for a new admin, shown once to the creating `ADMIN`. */
    fun oneTimePassword(): String = (1..ONE_TIME_LENGTH).map { ALPHABET[random.nextInt(ALPHABET.length)] }.joinToString("")

    private fun randomPassword(): String {
        val generator = SecureRandom()
        return (1..ONE_TIME_LENGTH).map { ALPHABET[generator.nextInt(ALPHABET.length)] }.joinToString("")
    }

    companion object {
        const val MIN_LENGTH = 12
        const val MAX_LENGTH = 128
        private const val SALT_LENGTH = 16
        private const val HASH_LENGTH = 32
        private const val PARALLELISM = 1
        private const val MEMORY_KIB = 65536
        private const val ITERATIONS = 3
        private const val ONE_TIME_LENGTH = 20

        // No look-alike characters (0/O, 1/l/I), so the password survives being read aloud.
        private const val ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    }
}
