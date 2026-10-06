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

    /** Open invitations of one shop for one phone number, locked so they can be closed safely. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    fun findAllByShopIdAndPhoneE164AndAcceptedAtIsNullAndExpiresAtAfter(
        shopId: UUID,
        phoneE164: String,
        now: Instant,
    ): List<Invitation>

    /** Locks the row so one code is accepted at most once, even by concurrent requests. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    fun findByShopIdAndCodeHash(
        shopId: UUID,
        codeHash: String,
    ): Invitation?
}
