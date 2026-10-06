package app.cetele.server.statements.link

import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import java.util.UUID

/** A token is a capability; only its shop id is read before using the tenant repository. */
@Component
class StatementLinkIndex(
    private val entityManager: EntityManager,
) {
    fun shopIdOf(tokenHash: String): UUID? =
        entityManager
            .createQuery("select l.shopId from StatementLink l where l.tokenHash = :hash", UUID::class.java)
            .setParameter("hash", tokenHash)
            .setMaxResults(1)
            .resultList
            .firstOrNull()

    fun shopIdOf(id: UUID): UUID? =
        entityManager
            .createQuery("select l.shopId from StatementLink l where l.id = :id", UUID::class.java)
            .setParameter("id", id)
            .setMaxResults(1)
            .resultList
            .firstOrNull()
}
