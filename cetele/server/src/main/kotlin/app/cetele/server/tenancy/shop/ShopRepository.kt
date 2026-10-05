package app.cetele.server.tenancy.shop

import app.cetele.server.tenancy.TenantRepository
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.util.UUID

interface ShopRepository : TenantRepository<Shop> {
    @Query("select s from Shop s where s.id = :shopId and s.deletedAt is null")
    fun findActive(
        @Param("shopId") shopId: UUID,
    ): Shop?

    /** Row lock that serialises invitation creation per shop (open-invitation cap). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Shop s where s.id = :shopId and s.deletedAt is null")
    fun lockActive(
        @Param("shopId") shopId: UUID,
    ): Shop?
}
