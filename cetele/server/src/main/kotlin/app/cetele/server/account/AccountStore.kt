package app.cetele.server.account

import app.cetele.server.tenancy.ShopLocks
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Component
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

@Component
class AccountStore(
    private val jdbc: JdbcClient,
    private val locks: ShopLocks,
) {
    fun lockUser(userId: UUID) {
        val found =
            jdbc
                .sql("SELECT id FROM users WHERE id = :id FOR UPDATE")
                .param("id", userId)
                .query(UUID::class.java)
                .optional()
                .orElse(null)
        if (found == null) throw ProblemException(ProblemCode.AUTH_UNAUTHENTICATED)
    }

    fun lockShop(shopId: UUID) {
        locks.deletion(shopId)
        jdbc
            .sql("SELECT id FROM shops WHERE id = :shopId FOR UPDATE")
            .param("shopId", shopId)
            .query(UUID::class.java)
            .optional()
    }

    fun owned(userId: UUID): List<UUID> =
        jdbc
            .sql("SELECT shop_id FROM memberships WHERE user_id = :id AND role = 'OWNER' ORDER BY shop_id")
            .param("id", userId)
            .query(UUID::class.java)
            .list()
            .map { checkNotNull(it) }

    fun shared(shopId: UUID): Boolean =
        jdbc
            .sql("SELECT count(*) FROM memberships WHERE shop_id = :shopId")
            .param("shopId", shopId)
            .query(Long::class.java)
            .single() > 1

    fun exists(shopId: UUID): Boolean =
        jdbc
            .sql("SELECT count(*) FROM shops WHERE id = :shopId")
            .param("shopId", shopId)
            .query(Long::class.java)
            .single() > 0

    /** True when a member other than [requesterId] joined the shop after [since], the time of the deletion choice. */
    fun joinedAfter(
        shopId: UUID,
        requesterId: UUID,
        since: Instant,
    ): Boolean =
        jdbc
            .sql("SELECT count(*) FROM memberships WHERE shop_id = :shopId AND user_id <> :requester AND created_at > :since")
            .param("shopId", shopId)
            .param("requester", requesterId)
            .param("since", Timestamp.from(since))
            .query(Long::class.java)
            .single() > 0

    fun role(
        shopId: UUID,
        userId: UUID,
    ): String? =
        jdbc
            .sql("SELECT role FROM memberships WHERE shop_id = :shopId AND user_id = :id")
            .param("shopId", shopId)
            .param("id", userId)
            .query(String::class.java)
            .optional()
            .orElse(null)

    fun transfer(
        shopId: UUID,
        callerId: UUID,
        targetId: UUID,
    ) {
        if (role(shopId, callerId) != "OWNER") throw ProblemException(ProblemCode.FORBIDDEN)
        if (callerId == targetId) throw ProblemException(ProblemCode.MEMBERSHIP_OWNER_LOCKED)
        val active =
            jdbc
                .sql("SELECT count(*) FROM users WHERE id = :id AND deactivated_at IS NULL")
                .param("id", targetId)
                .query(Long::class.java)
                .single() == 1L
        if (!active || role(shopId, targetId) != "STAFF") throw ProblemException(ProblemCode.NOT_FOUND)
        jdbc
            .sql("UPDATE memberships SET role = 'STAFF' WHERE shop_id = :shopId AND user_id = :id AND role = 'OWNER'")
            .param("shopId", shopId)
            .param("id", callerId)
            .update()
        val promoted =
            jdbc
                .sql("UPDATE memberships SET role = 'OWNER' WHERE shop_id = :shopId AND user_id = :id AND role = 'STAFF'")
                .param("shopId", shopId)
                .param("id", targetId)
                .update()
        check(promoted == 1) { "ownership transfer could not complete" }
    }
}
