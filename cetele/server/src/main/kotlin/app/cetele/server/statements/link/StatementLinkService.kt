package app.cetele.server.statements.link

import app.cetele.server.config.PublicUrlProperties
import app.cetele.server.tenancy.shop.ShopRepository
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID

data class IssuedStatementLink(
    val id: UUID,
    val token: String,
    val url: String,
    val expiresAt: Instant,
)

data class ResolvedLink(
    val id: UUID,
    val shopId: UUID,
    val customerId: UUID,
)

@Service
class StatementLinkService(
    private val links: StatementLinkRepository,
    private val index: StatementLinkIndex,
    private val hasher: StatementLinkHasher,
    private val shops: ShopRepository,
    private val publicUrl: PublicUrlProperties,
) {
    private val random = SecureRandom()

    /** The caller resolves the active customer in this shop before issuing a link. */
    @Transactional
    fun issue(
        shopId: UUID,
        customerId: UUID,
        createdBy: UUID?,
        ttl: Duration = Duration.ofDays(30),
        now: Instant,
    ): IssuedStatementLink {
        require(!ttl.isNegative && !ttl.isZero) { "statement link lifetime must be positive" }
        // The shop row serialises the count and insert, including the first link for a customer.
        shops.lockActive(shopId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        if (links.countByShopIdAndCustomerIdAndRevokedAtIsNullAndExpiresAtAfter(shopId, customerId, now) >= OPEN_LIMIT) {
            throw ProblemException(ProblemCode.STATEMENT_LINK_LIMIT)
        }
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(random::nextBytes))
        val row = links.save(StatementLink(shopId, customerId, hasher.hash(token), now.plus(ttl), createdBy, now))
        return IssuedStatementLink(checkNotNull(row.id), token, "${publicUrl.baseUrl}/s/$token", row.expiresAt)
    }

    @Transactional(readOnly = true)
    fun resolve(
        token: String,
        now: Instant,
    ): ResolvedLink? {
        if (!TOKEN_PATTERN.matches(token)) return null
        val hash = hasher.hash(token)
        val shopId = index.shopIdOf(hash) ?: return null
        val row = links.findByShopIdAndTokenHash(shopId, hash) ?: return null
        if (row.revokedAt != null || !now.isBefore(row.expiresAt)) return null
        return ResolvedLink(checkNotNull(row.id), row.shopId, row.customerId)
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun markOpened(
        id: UUID,
        now: Instant,
    ) {
        val shopId = index.shopIdOf(id) ?: return
        links.markOpened(shopId, id, now)
    }

    @Transactional
    fun revokeForCustomer(
        shopId: UUID,
        customerId: UUID,
        now: Instant,
    ) {
        shops.lockActive(shopId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        links.revokeForCustomer(shopId, customerId, now)
    }

    companion object {
        const val OPEN_LIMIT = 20L
        private val TOKEN_PATTERN = Regex("^[A-Za-z0-9_-]{43}$")
    }
}
