package app.cetele.server.tenancy.invitation

import app.cetele.server.tenancy.TenantRepository
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.Lock
import java.time.Instant
import java.util.UUID

interface InvitationRepository : TenantRepository<Invitation> {
    fun countByShopIdAndAcceptedAtIsNullAndExpiresAtAfter(
        shopId: UUID,
        now: Instant,
    ): Long

    /** Locks the row so one code is accepted at most once, even by concurrent requests. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    fun findByShopIdAndCodeHash(
        shopId: UUID,
        codeHash: String,
    ): Invitation?
}
