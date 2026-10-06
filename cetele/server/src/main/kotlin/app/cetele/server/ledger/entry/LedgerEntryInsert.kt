package app.cetele.server.ledger.entry

import jakarta.persistence.EntityManager
import java.util.UUID

interface LedgerEntryInsert {
    fun insert(
        shopId: UUID,
        entry: LedgerEntry,
    ): LedgerEntry
}

class LedgerEntryInsertImpl(
    private val entityManager: EntityManager,
) : LedgerEntryInsert {
    override fun insert(
        shopId: UUID,
        entry: LedgerEntry,
    ): LedgerEntry {
        require(entry.shopId == shopId)
        entityManager.persist(entry)
        entityManager.flush()
        return entry
    }
}
