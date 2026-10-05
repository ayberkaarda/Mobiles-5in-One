package app.cetele.archfixtures.domain

import jakarta.persistence.EntityManager
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.CrudRepository
import org.springframework.data.repository.Repository
import java.util.UUID

// Fixture classes for ArchitectureTest: each rule must flag the "bad" fixture and accept the
// "good" one. They live outside app.cetele.server so the application never scans them.

interface TenantScoped {
    val shopId: UUID
}

interface TenantRepository<T : TenantScoped> : Repository<T, UUID>

class Ledger(
    override val shopId: UUID,
) : TenantScoped

class Plain(
    val id: UUID,
)

interface GoodLedgerRepository : TenantRepository<Ledger> {
    fun findByIdAndShopId(
        id: UUID,
        shopId: UUID,
    ): Ledger?
}

interface BadLedgerRepository : CrudRepository<Ledger, UUID>

interface LeakyLedgerRepository : TenantRepository<Ledger> {
    fun findByLabel(label: String): List<Ledger>
}

interface PlainRepository : CrudRepository<Plain, UUID>

interface NativeQueries : Repository<Plain, UUID> {
    @Query(value = "SELECT * FROM plain", nativeQuery = true)
    fun everything(): List<Plain>

    @Query("SELECT p FROM Plain p")
    fun jpql(): List<Plain>
}

class NativeCaller(
    private val entityManager: EntityManager,
) {
    fun count(): Any = entityManager.createNativeQuery("SELECT count(*) FROM plain").singleResult
}

class EnvReader {
    fun value(): String? = System.getenv("FIXTURE_VALUE")
}
