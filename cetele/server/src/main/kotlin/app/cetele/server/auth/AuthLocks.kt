package app.cetele.server.auth

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.UUID

/**
 * Transaction-scoped PostgreSQL advisory locks that serialise the sign-in writes which must not
 * interleave: everything that rotates or revokes the tokens of one refresh family, and the issue
 * of a new code for one phone. A lock is held until the surrounding transaction ends.
 *
 * Under READ COMMITTED a bulk `UPDATE` does not see rows inserted by a transaction that commits
 * while it runs; taking the same lock first makes the revoking statement start only after a
 * concurrent rotation has committed its successor token.
 */
@Component
class AuthLocks(
    private val jdbc: JdbcClient,
) {
    /** Locks one refresh family. */
    fun family(familyId: UUID) = lock(key(FAMILY, familyId.toString()))

    /** Locks several families in ascending key order, so two callers can never deadlock. */
    fun families(familyIds: Collection<UUID>) =
        familyIds
            .map { key(FAMILY, it.toString()) }
            .distinct()
            .sorted()
            .forEach(::lock)

    /** Locks the OTP issue of one phone. */
    fun otpPhone(phoneE164: String) = lock(key(OTP_PHONE, phoneE164))

    private fun lock(key: Long) {
        check(TransactionSynchronizationManager.isActualTransactionActive()) { "advisory locks need a transaction" }
        jdbc
            .sql("SELECT pg_advisory_xact_lock(:key)")
            .param("key", key)
            .query()
            .singleValue()
    }

    companion object {
        private const val FAMILY = "refresh.family"
        private const val OTP_PHONE = "otp.phone"

        /** First eight bytes of SHA-256(namespace:subject): a 64-bit key that other namespaces do not collide with. */
        fun key(
            namespace: String,
            subject: String,
        ): Long = ByteBuffer.wrap(MessageDigest.getInstance("SHA-256").digest("$namespace:$subject".toByteArray(Charsets.UTF_8))).long
    }
}
