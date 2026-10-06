package app.cetele.server.ledger.customer

import app.cetele.server.tenancy.TenantRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.util.UUID

interface CustomerRepository :
    TenantRepository<Customer>,
    CustomerInsert {
    @Query("select count(c) > 0 from Customer c where c.shopId <> :shopId and c.id = :id")
    fun existsOutsideShop(
        @Param("shopId") shopId: UUID,
        @Param("id") id: UUID,
    ): Boolean

    fun findByShopIdAndId(
        shopId: UUID,
        id: UUID,
    ): Customer?

    @Query("select c from Customer c where c.shopId = :shopId and c.id = :id and c.deletedAt is null")
    fun findActive(
        @Param("shopId") shopId: UUID,
        @Param("id") id: UUID,
    ): Customer?

    @Query("select count(c) from Customer c where c.shopId = :shopId and c.deletedAt is null")
    fun countLive(
        @Param("shopId") shopId: UUID,
    ): Long
}
