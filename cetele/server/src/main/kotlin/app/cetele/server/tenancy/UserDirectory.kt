package app.cetele.server.tenancy

import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Component
import java.util.UUID

/** Profile fields of a user that member management shows to the shop owner. */
data class UserProfile(
    val userId: UUID,
    val phoneE164: String,
    val displayName: String?,
)

/**
 * Read-only lookups in `users` for tenancy (invited phone checks, member lists). The `users`
 * table belongs to the auth module; tenancy only reads it, with bound parameters.
 */
@Component
class UserDirectory(
    private val jdbc: NamedParameterJdbcTemplate,
) {
    fun profileOf(userId: UUID): UserProfile? = profilesOf(listOf(userId))[userId]

    /** Active (not deactivated) user holding [phoneE164], if any. */
    fun activeUserIdByPhone(phoneE164: String): UUID? =
        jdbc
            .queryForList(
                "SELECT id FROM users WHERE phone_e164 = :phone AND deactivated_at IS NULL",
                mapOf("phone" to phoneE164),
                UUID::class.java,
            ).firstOrNull()

    fun profilesOf(userIds: Collection<UUID>): Map<UUID, UserProfile> {
        if (userIds.isEmpty()) return emptyMap()
        return jdbc
            .query(
                "SELECT id, phone_e164, display_name FROM users WHERE id IN (:ids)",
                mapOf("ids" to userIds.toSet()),
            ) { rs, _ ->
                UserProfile(
                    userId = rs.getObject("id", UUID::class.java),
                    phoneE164 = rs.getString("phone_e164"),
                    displayName = rs.getString("display_name"),
                )
            }.associateBy { it.userId }
    }
}
