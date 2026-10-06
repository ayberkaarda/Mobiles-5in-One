package app.cetele.server.tenancy.invitation

import app.cetele.server.security.CurrentUser
import app.cetele.server.security.ShopRole
import app.cetele.server.tenancy.MembershipResolver
import app.cetele.server.tenancy.UserDirectory
import app.cetele.server.tenancy.membership.Membership
import app.cetele.server.tenancy.membership.MembershipRepository
import app.cetele.server.tenancy.shop.ShopRepository
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

/** The new invitation, returned to the owner once; the code is not stored and cannot be shown again. */
data class IssuedInvitation(
    val id: UUID,
    val code: String,
    val phone: String,
    val expiresAt: Instant,
)

data class AcceptedInvitation(
    val shopId: UUID,
    val role: ShopRole,
)

@Service
class InvitationService(
    private val invitations: InvitationRepository,
    private val codeIndex: InvitationCodeIndex,
    private val shops: ShopRepository,
    private val memberships: MembershipRepository,
    private val resolver: MembershipResolver,
    private val users: UserDirectory,
    private val limiter: InvitationAcceptLimiter,
    private val hasher: InvitationCodeHasher,
    private val clock: Clock,
) {
    @Transactional
    fun issue(
        shopId: UUID,
        caller: CurrentUser,
        phoneE164: String,
    ): IssuedInvitation {
        val tenant = resolver.resolve(shopId, caller)
        // Serialises invitation creation per shop so the open-invitation cap holds under concurrency.
        shops.lockActive(tenant.shopId) ?: throw ProblemException(ProblemCode.NOT_FOUND, "shop not found")
        val invitedUser = users.activeUserIdByPhone(phoneE164)
        if (invitedUser != null && memberships.existsByShopIdAndUserId(tenant.shopId, invitedUser)) {
            throw ProblemException(ProblemCode.MEMBERSHIP_ALREADY_MEMBER, "invited phone is already a member")
        }
        val now = clock.instant()
        if (invitations.countByShopIdAndAcceptedAtIsNullAndExpiresAtAfter(tenant.shopId, now) >= MAX_OPEN_PER_SHOP) {
            throw ProblemException(ProblemCode.CONFLICT, "open invitation limit reached")
        }
        val code = freshCode()
        val invitation =
            invitations.save(
                Invitation(
                    shopId = tenant.shopId,
                    phoneE164 = phoneE164,
                    codeHash = hasher.hash(code),
                    expiresAt = now.plus(VALIDITY),
                    createdBy = tenant.userId,
                    createdAt = now,
                ),
            )
        return IssuedInvitation(id = checkNotNull(invitation.id), code = code, phone = phoneE164, expiresAt = invitation.expiresAt)
    }

    /**
     * Accepts an invitation for the caller. An unknown, malformed, expired or already used code,
     * and a code issued for another phone number, all end in the same `not_found`.
     */
    @Transactional
    fun accept(
        caller: CurrentUser,
        rawCode: String,
    ): AcceptedInvitation {
        limiter.consume(caller.userId)
        val code = InvitationCode.normalize(rawCode) ?: throw notFound("malformed code")
        val codeHash = hasher.hash(code)
        val shopId = codeIndex.shopIdOf(codeHash) ?: throw notFound("unknown code")
        val invitation = invitations.findByShopIdAndCodeHash(shopId, codeHash) ?: throw notFound("unknown code")
        shops.findActive(shopId) ?: throw notFound("shop deleted")
        val now = clock.instant()
        if (!invitation.isOpen(now)) throw notFound("expired or used code")
        val callerPhone = users.profileOf(caller.userId)?.phoneE164 ?: throw notFound("caller has no profile")
        if (callerPhone != invitation.phoneE164) throw notFound("code issued for another phone")
        if (memberships.existsByShopIdAndUserId(shopId, caller.userId)) {
            throw ProblemException(ProblemCode.MEMBERSHIP_ALREADY_MEMBER, "caller is already a member")
        }
        invitation.accept(now)
        invitations.save(invitation)
        // Any other open code for this phone is spent too: it must not outlive a later removal.
        closeOpen(shopId, invitation.phoneE164, now)
        memberships.save(Membership(shopId = shopId, userId = caller.userId, role = ShopRole.STAFF, createdAt = now))
        return AcceptedInvitation(shopId = shopId, role = ShopRole.STAFF)
    }

    /**
     * Closes every open invitation of [shopId] for [phoneE164]. Called when that phone's member is
     * removed, so a second code issued earlier cannot bring the removed member back.
     */
    @Transactional
    fun revokeOpen(
        shopId: UUID,
        phoneE164: String,
    ) = closeOpen(shopId, phoneE164, clock.instant())

    private fun closeOpen(
        shopId: UUID,
        phoneE164: String,
        now: Instant,
    ) {
        invitations
            .findAllByShopIdAndPhoneE164AndAcceptedAtIsNullAndExpiresAtAfter(shopId, phoneE164, now)
            .forEach { open ->
                open.revoke(now)
                invitations.save(open)
            }
    }

    private fun freshCode(): String {
        repeat(MAX_CODE_ATTEMPTS) {
            val code = InvitationCode.generate()
            if (!codeIndex.isTaken(hasher.hash(code))) return code
        }
        throw ProblemException(ProblemCode.SERVER_ERROR, "no free invitation code")
    }

    private fun notFound(reason: String) = ProblemException(ProblemCode.NOT_FOUND, "invitation rejected: $reason")

    companion object {
        const val MAX_OPEN_PER_SHOP = 5L
        val VALIDITY: Duration = Duration.ofHours(24)
        private const val MAX_CODE_ATTEMPTS = 5
    }
}
