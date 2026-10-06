package app.cetele.server.auth

import app.cetele.server.security.TraceIdFilter
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.util.UUID

/** A row of `users` as sign-in and `/v1/me` need it. */
data class UserAccount(
    val id: UUID,
    val phoneE164: String,
    val displayName: String?,
    val active: Boolean,
)

/**
 * The only `JdbcClient` user of the auth module: access to `users` (created by V1, shared with
 * tenancy). Plain bound-parameter SQL keeps the sign-in upsert race free
 * (`INSERT ... ON CONFLICT DO NOTHING`) without mapping a second JPA entity onto a table another
 * module reads. No statement is built from input; every value is a named parameter.
 */
@Component
class UserStore(
    private val jdbc: JdbcClient,
) {
    /** Returns the user of [phoneE164], creating it first when absent; `created` tells which. */
    fun findOrCreate(phoneE164: String): Pair<UserAccount, Boolean> {
        val inserted =
            jdbc
                .sql("INSERT INTO users (id, phone_e164) VALUES (:id, :phone) ON CONFLICT (phone_e164) DO NOTHING")
                .param("id", TraceIdFilter.uuidV7())
                .param("phone", phoneE164)
                .update()
        val account = findByPhone(phoneE164) ?: error("user row missing after upsert")
        return account to (inserted == 1)
    }

    fun findByPhone(phoneE164: String): UserAccount? =
        jdbc
            .sql("SELECT id, phone_e164, display_name, deactivated_at IS NULL AS active FROM users WHERE phone_e164 = :phone")
            .param("phone", phoneE164)
            .query(::toAccount)
            .optional()
            .orElse(null)

    fun findById(id: UUID): UserAccount? =
        jdbc
            .sql("SELECT id, phone_e164, display_name, deactivated_at IS NULL AS active FROM users WHERE id = :id")
            .param("id", id)
            .query(::toAccount)
            .optional()
            .orElse(null)

    fun updateDisplayName(
        id: UUID,
        displayName: String,
    ): Int =
        jdbc
            .sql("UPDATE users SET display_name = :name WHERE id = :id AND deactivated_at IS NULL")
            .param("name", displayName)
            .param("id", id)
            .update()

    private fun toAccount(
        rs: ResultSet,
        @Suppress("UNUSED_PARAMETER") row: Int,
    ): UserAccount =
        UserAccount(
            id = rs.getObject("id", UUID::class.java),
            phoneE164 = rs.getString("phone_e164"),
            displayName = rs.getString("display_name"),
            active = rs.getBoolean("active"),
        )
}
