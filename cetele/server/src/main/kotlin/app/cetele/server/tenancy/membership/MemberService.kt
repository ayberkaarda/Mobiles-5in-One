package app.cetele.server.tenancy.membership

import app.cetele.server.config.logging.Masking
import app.cetele.server.security.CurrentUser
import app.cetele.server.security.ShopRole
import app.cetele.server.tenancy.MembershipResolver
import app.cetele.server.tenancy.UserDirectory
import app.cetele.server.tenancy.invitation.InvitationService
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/** A member as listed to the shop owner. The phone number is masked (`+90*******12`). */
data class MemberView(
    val userId: UUID,
    val role: ShopRole,
    val displayName: String?,
    val phone: String,
    val joinedAt: Instant,
)

@Service
class MemberService(
    private val memberships: MembershipRepository,
    private val resolver: MembershipResolver,
    private val users: UserDirectory,
    private val invitations: InvitationService,
) {
    @Transactional(readOnly = true)
    fun list(
        shopId: UUID,
        caller: CurrentUser,
    ): List<MemberView> {
        val tenant = resolver.resolve(shopId, caller)
        val rows = memberships.findAllByShopIdOrderByCreatedAtAsc(tenant.shopId)
        val profiles = users.profilesOf(rows.map { it.userId })
        return rows.map { membership ->
            val profile = profiles[membership.userId]
            MemberView(
                userId = membership.userId,
                role = membership.role,
                displayName = profile?.displayName,
                phone = profile?.let { Masking.phone(it.phoneE164) } ?: "",
                joinedAt = membership.createdAt,
            )
        }
    }

    /**
     * Removes a member. The owner's own membership is locked (one owner per shop; ownership
     * transfer comes with account deletion), and a user who is not a member of this shop is 404.
     * Open invitations of this shop for the removed member's phone are closed in the same
     * transaction, so an earlier second code cannot bring them back.
     */
    @Transactional
    fun remove(
        shopId: UUID,
        caller: CurrentUser,
        userId: UUID,
    ) {
        val tenant = resolver.resolve(shopId, caller)
        if (userId == tenant.userId) {
            throw ProblemException(ProblemCode.MEMBERSHIP_OWNER_LOCKED, "own membership cannot be removed")
        }
        val membership =
            memberships.findActive(tenant.shopId, userId)
                ?: throw ProblemException(ProblemCode.NOT_FOUND, "member not found")
        if (membership.role == ShopRole.OWNER) {
            throw ProblemException(ProblemCode.MEMBERSHIP_OWNER_LOCKED, "owner membership cannot be removed")
        }
        memberships.delete(membership)
        users.profileOf(userId)?.let { invitations.revokeOpen(tenant.shopId, it.phoneE164) }
    }
}
