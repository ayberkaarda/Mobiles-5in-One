package app.cetele.server.sync.changelog

import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

@Component
class ShopSequence(
    private val entityManager: EntityManager,
) {
    @Transactional(propagation = Propagation.MANDATORY)
    fun lock(shopId: UUID) {
        entityManager
            .createNativeQuery(
                "INSERT INTO shop_sequences (shop_id, last_seq) VALUES (:shopId, 0) ON CONFLICT (shop_id) DO NOTHING",
            ).setParameter("shopId", shopId)
            .executeUpdate()
        entityManager
            .createNativeQuery("SELECT last_seq FROM shop_sequences WHERE shop_id = :shopId FOR UPDATE")
            .setParameter("shopId", shopId)
            .singleResult
    }

    @Transactional(propagation = Propagation.MANDATORY)
    fun next(shopId: UUID): Long =
        (
            entityManager
                .createNativeQuery("UPDATE shop_sequences SET last_seq = last_seq + 1 WHERE shop_id = :shopId RETURNING last_seq")
                .setParameter("shopId", shopId)
                .singleResult as Number
        ).toLong()

    @Transactional(readOnly = true)
    fun head(shopId: UUID): Long =
        entityManager
            .createNativeQuery("SELECT last_seq FROM shop_sequences WHERE shop_id = :shopId")
            .setParameter("shopId", shopId)
            .resultList
            .firstOrNull()
            ?.let { (it as Number).toLong() } ?: 0L
}
