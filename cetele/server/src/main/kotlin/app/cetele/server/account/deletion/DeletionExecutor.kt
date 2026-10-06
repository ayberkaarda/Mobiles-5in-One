package app.cetele.server.account.deletion

import app.cetele.server.account.AccountStore
import app.cetele.server.auth.UserStore
import app.cetele.server.config.JobLocks
import app.cetele.server.media.store.MediaStore
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Instant
import java.util.UUID

@Component
class DeletionExecutor(
    private val requests: DeletionRequestRepository,
    private val store: AccountStore,
    private val users: UserStore,
    private val media: MediaStore,
    private val jdbc: JdbcClient,
    private val jobs: JobLocks,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(DeletionExecutor::class.java)
    private val tx =
        TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }

    @Scheduled(cron = "0 0 * * * *", zone = "Europe/Istanbul")
    fun scheduled() = run(clock.instant())

    fun run(now: Instant) {
        jobs.runExclusive("deletion") {
            requests.due(now).forEach { id ->
                try {
                    tx.executeWithoutResult { complete(id, now) }
                } catch (e: Exception) {
                    // Exception class only: messages of storage or SQL errors may carry keys or values.
                    log.warn("Deletion outcome=retry request={} reason={}", id, e.javaClass.simpleName)
                }
            }
        }
    }

    private fun complete(
        id: UUID,
        now: Instant,
    ) {
        val scope =
            jdbc
                .sql("SELECT kind, user_id, shop_id FROM deletion_requests WHERE id = :id")
                .param("id", id)
                .query { rs, _ ->
                    Triple(rs.getString("kind"), rs.getObject("user_id", UUID::class.java), rs.getObject("shop_id", UUID::class.java))
                }.optional()
                .orElse(null) ?: return
        if (scope.first == "SHOP") {
            store.lockShop(checkNotNull(scope.third))
        } else if (users.findById(scope.second) != null) {
            store.lockUser(scope.second)
        }
        // Serialize cancellation and execution before reading the current request state.
        jdbc
            .sql("SELECT id FROM deletion_requests WHERE id = :id FOR UPDATE")
            .param("id", id)
            .query(UUID::class.java)
            .optional()
        val request = requests.findById(id) ?: return
        if (request.cancelledAt != null || request.completedAt != null || request.graceUntil > now) return
        if (request.kind == DeletionKind.SHOP) {
            completeShop(request, now)
            return
        }
        val user = users.findById(request.userId)
        if (user == null) {
            request.completedAt = now
            requests.save(request)
            return
        }
        val shops = store.owned(user.id)
        shops.forEach(store::lockShop)
        // Owned shops whose own SHOP request is still live are left to that request (it runs first and was an
        // explicit choice); every other owned shop must be empty of other members, or the account is blocked.
        val pending = shops.filter { shopId -> requests.openShop(shopId)?.let { it.blockedAt == null } ?: false }
        if (shops.filterNot(pending::contains).any(store::shared)) {
            request.blockedAt = now
            requests.save(request)
            log.info("Account deletion outcome=blocked user={}", user.id)
            return
        }
        request.blockedAt = null
        if (pending.any(store::shared)) {
            requests.save(request)
            log.info("Account deletion outcome=waiting user={} shops={}", user.id, pending.size)
            return
        }
        shops.forEach { shopId ->
            deleteShop(shopId)
            requests.openShop(shopId)?.let {
                it.completedAt = now
                requests.save(it)
            }
        }
        listOf("refresh_tokens", "devices").forEach { table ->
            jdbc.sql("DELETE FROM $table WHERE user_id = :id").param("id", user.id).update()
        }
        jdbc.sql("DELETE FROM otp_codes WHERE phone_e164 = :phone").param("phone", user.phoneE164).update()
        // Invitations addressed to the user's phone in any shop carry the phone number (PII).
        jdbc.sql("DELETE FROM invitations WHERE phone_e164 = :phone").param("phone", user.phoneE164).update()
        jdbc.sql("DELETE FROM memberships WHERE user_id = :id").param("id", user.id).update()
        jdbc.sql("DELETE FROM users WHERE id = :id").param("id", user.id).update()
        request.completedAt = now
        requests.save(request)
        log.info("account deletion completed user={} shops={}", user.id, shops.size)
    }

    /**
     * A SHOP request carries the owner's choice as it stood when it was made. It is dropped when the requester no
     * longer owns the shop (ownership was transferred), and it is blocked while a member who joined after the
     * request is present: that member's shop is never deleted without a fresh choice (re-evaluated every run).
     */
    private fun completeShop(
        request: DeletionRequest,
        now: Instant,
    ) {
        val shopId = checkNotNull(request.shopId)
        if (!store.exists(shopId)) {
            request.completedAt = now
            requests.save(request)
            return
        }
        if (store.role(shopId, request.userId) != "OWNER") {
            request.cancelledAt = now
            requests.save(request)
            log.info("Shop deletion outcome=owner_changed shop={}", shopId)
            return
        }
        if (store.joinedAfter(shopId, request.userId, request.createdAt)) {
            request.blockedAt = now
            requests.save(request)
            log.info("Shop deletion outcome=blocked shop={}", shopId)
            return
        }
        deleteShop(shopId)
        request.blockedAt = null
        request.completedAt = now
        requests.save(request)
        log.info("Shop deletion completed shop={}", shopId)
    }

    private fun deleteShop(shopId: UUID) {
        store.lockShop(shopId)
        media.deletePrefix("media/$shopId/")
        media.deletePrefix("uploads/$shopId/")
        SHOP_TABLES.forEach { table ->
            jdbc.sql("DELETE FROM $table WHERE shop_id = :shopId").param("shopId", shopId).update()
        }
        jdbc.sql("DELETE FROM shops WHERE id = :shopId").param("shopId", shopId).update()
    }

    companion object {
        private val SHOP_TABLES =
            listOf(
                "reminders",
                "statement_links",
                "sync_outbox_receipts",
                "change_log",
                "ledger_entries",
                "customers",
                "media_objects",
                "sms_quota",
                "invitations",
                "shop_sequences",
                "memberships",
            )
    }
}
