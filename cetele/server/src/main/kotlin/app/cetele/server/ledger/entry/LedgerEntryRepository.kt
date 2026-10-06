package app.cetele.server.ledger.entry

import app.cetele.server.ledger.money.BalanceLine
import app.cetele.server.tenancy.TenantRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.util.UUID

interface LedgerEntryRepository :
    TenantRepository<LedgerEntry>,
    LedgerEntryInsert {
    @Query("select e from LedgerEntry e where e.shopId = :shopId and e.id = :id")
    fun findActiveByShopIdAndId(
        @Param("shopId") shopId: UUID,
        @Param("id") id: UUID,
    ): LedgerEntry?

    fun findAllByShopIdAndCustomerIdOrderByOccurredOnAscCreatedAtAsc(
        shopId: UUID,
        customerId: UUID,
    ): List<LedgerEntry>

    @Query(
        "select new app.cetele.server.ledger.money.BalanceLine(e.type, e.amountMinor, e.reverses, e.reversedBy) from LedgerEntry e where e.shopId = :shopId and e.customerId = :customerId",
    )
    fun balanceLines(
        @Param("shopId") shopId: UUID,
        @Param("customerId") customerId: UUID,
    ): List<BalanceLine>
}
