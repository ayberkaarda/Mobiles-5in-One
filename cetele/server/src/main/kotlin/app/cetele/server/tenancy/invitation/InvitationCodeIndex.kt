package app.cetele.server.tenancy.invitation

import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * Maps a code hash to the shop it was issued for. An invitation code is a capability that selects
 * its shop (the accept path carries no shop id), so this lookup is keyed by the hash alone and
 * returns nothing but the shop id; the invitation row itself is then read through
 * [InvitationRepository] scoped by that shop.
 */
@Component
class InvitationCodeIndex(
    private val entityManager: EntityManager,
) {
    fun shopIdOf(codeHash: String): UUID? =
        entityManager
            .createQuery("select i.shopId from Invitation i where i.codeHash = :codeHash", UUID::class.java)
            .setParameter("codeHash", codeHash)
            .setMaxResults(1)
            .resultList
            .firstOrNull()

    fun isTaken(codeHash: String): Boolean = shopIdOf(codeHash) != null
}
