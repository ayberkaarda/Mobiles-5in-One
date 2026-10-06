package app.cetele.archfixtures.sync

import app.cetele.archfixtures.domain.Plain
import jakarta.persistence.EntityManager
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.Repository

class SyncNativeCaller(
    private val entityManager: EntityManager,
) {
    fun count(): Any = entityManager.createNativeQuery("SELECT 1").singleResult
}

interface SyncNativeRepository : Repository<Plain, java.util.UUID> {
    @Query(value = "SELECT 1", nativeQuery = true)
    fun count(): Int
}
