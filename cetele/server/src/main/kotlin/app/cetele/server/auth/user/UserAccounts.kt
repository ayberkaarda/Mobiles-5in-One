package app.cetele.server.auth.user

import app.cetele.server.security.TraceIdFilter
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.util.UUID

/** A row of `users` as sign-in and `/v1/me` need it. */
data class UserAccount(
    val id: UUID,
    val phoneE164: String,
    val displayName: String?,
    val active: Boolean,
)

/** A membership of the caller, for `GET /v1/me`. */
data class MembershipSummary(
    val shopId: UUID,
    val role: String,
)

/**
 * Access to `users` (created by V1, shared with tenancy) and the caller's memberships. Plain
 * bound-parameter SQL keeps the user upsert race free (`ON CONFLICT DO NOTHING`) without mapping
 * a second JPA entity onto tables another module owns.
 */
@Component
class UserAccounts(
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

    /** Memberships of [userId] in shops that are not deleted, oldest shop id first. */
    fun memberships(userId: UUID): List<MembershipSummary> =
        jdbc
            .sql(
                """
                SELECT m.shop_id, m.role FROM memberships m JOIN shops s ON s.id = m.shop_id
                WHERE m.user_id = :user AND s.deleted_at IS NULL
                ORDER BY m.shop_id
                """.trimIndent(),
            ).param("user", userId)
            .query { rs, _ -> MembershipSummary(rs.getObject("shop_id", UUID::class.java), rs.getString("role")) }
            .list()

    private fun toAccount(
        rs: java.sql.ResultSet,
        @Suppress("UNUSED_PARAMETER") row: Int,
    ): UserAccount =
        UserAccount(
            id = rs.getObject("id", UUID::class.java),
            phoneE164 = rs.getString("phone_e164"),
            displayName = rs.getString("display_name"),
            active = rs.getBoolean("active"),
        )
}
