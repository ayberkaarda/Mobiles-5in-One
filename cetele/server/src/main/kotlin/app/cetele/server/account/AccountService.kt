package app.cetele.server.account

import app.cetele.server.account.deletion.DeletionKind
import app.cetele.server.account.deletion.DeletionRequest
import app.cetele.server.account.deletion.DeletionRequestRepository
import app.cetele.server.security.CurrentUser
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

data class DeletionStatus(
    val requestedAt: Instant,
    val graceUntil: Instant,
    val blocked: Boolean,
)

data class DeletionReceipt(
    val requestedAt: Instant,
    val graceUntil: Instant,
)

data class AccountDeletionReceipt(
    val requestedAt: Instant,
    val graceUntil: Instant,
    val shopsToDelete: List<UUID>,
)

data class OwnershipReceipt(
    val shopId: UUID,
    val ownerUserId: UUID,
    val previousOwnerUserId: UUID,
)

@Service
class AccountService(
    private val requests: DeletionRequestRepository,
    private val store: AccountStore,
    private val reauth: ReauthVerifier,
    private val tx: TransactionTemplate,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(AccountService::class.java)

    fun deletion(userId: UUID): DeletionStatus? =
        requests.openAccount(userId)?.let {
            DeletionStatus(it.requestedAt, it.graceUntil, it.blockedAt != null)
        }

    fun requestAccount(
        caller: CurrentUser,
        code: String,
        deleteOwnedShops: Boolean,
    ): AccountDeletionReceipt {
        // Microsecond precision, as stored: linked SHOP rows are found again by an exact requested_at match.
        val now = clock.instant().truncatedTo(ChronoUnit.MICROS)
        reauth.require(caller, code, now)
        return tx.execute {
            store.lockUser(caller.userId)
            if (requests.openAccount(caller.userId) != null) throw ProblemException(ProblemCode.ACCOUNT_DELETION_PENDING)
            val shops = store.owned(caller.userId)
            shops.forEach(store::lockShop)
            if (!deleteOwnedShops && shops.any(store::shared)) throw ProblemException(ProblemCode.ACCOUNT_OWNER_OF_SHARED_SHOP)
            val until = now.plus(GRACE)
            requests.save(DeletionRequest(kind = DeletionKind.ACCOUNT, userId = caller.userId, requestedAt = now, graceUntil = until))
            // A shop that already has its own open request keeps it (and its earlier grace end); no second row.
            shops.filter { requests.openShop(it) == null }.forEach {
                requests.save(
                    DeletionRequest(kind = DeletionKind.SHOP, userId = caller.userId, shopId = it, requestedAt = now, graceUntil = until),
                )
            }
            log.info("Account deletion requested user={} shops={}", caller.userId, shops.size)
            AccountDeletionReceipt(now, until, shops)
        }
    }

    fun cancelAccount(caller: CurrentUser) {
        tx.executeWithoutResult {
            store.lockUser(caller.userId)
            val request = requests.openAccount(caller.userId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
            val now = clock.instant()
            request.cancelledAt = now
            requests.save(request)
            requests.linkedShops(caller.userId, request.requestedAt).forEach {
                it.cancelledAt = now
                requests.save(it)
            }
        }
    }

    fun requestShop(
        shopId: UUID,
        caller: CurrentUser,
        code: String,
    ): DeletionReceipt {
        val now = clock.instant()
        reauth.require(caller, code, now)
        return tx.execute {
            store.lockShop(shopId)
            if (store.role(shopId, caller.userId) != "OWNER") throw ProblemException(ProblemCode.FORBIDDEN)
            if (requests.openShop(shopId) != null) throw ProblemException(ProblemCode.SHOP_DELETION_PENDING)
            val until = now.plus(GRACE)
            requests.save(
                DeletionRequest(kind = DeletionKind.SHOP, userId = caller.userId, shopId = shopId, requestedAt = now, graceUntil = until),
            )
            DeletionReceipt(now, until)
        }
    }

    fun cancelShop(
        shopId: UUID,
        caller: CurrentUser,
    ) {
        tx.executeWithoutResult {
            store.lockShop(shopId)
            if (store.role(shopId, caller.userId) != "OWNER") throw ProblemException(ProblemCode.FORBIDDEN)
            val request = requests.openShop(shopId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
            request.cancelledAt = clock.instant()
            requests.save(request)
        }
    }

    fun transfer(
        shopId: UUID,
        caller: CurrentUser,
        targetId: UUID,
        code: String,
    ): OwnershipReceipt {
        reauth.require(caller, code, clock.instant())
        return tx.execute {
            store.lockUser(caller.userId)
            store.lockShop(shopId)
            store.transfer(shopId, caller.userId, targetId)
            requests.openAccount(caller.userId)?.let {
                it.blockedAt = null
                requests.save(it)
            }
            log.info("Ownership transferred shop={} previousOwner={} owner={}", shopId, caller.userId, targetId)
            OwnershipReceipt(shopId, targetId, caller.userId)
        }
    }

    companion object {
        val GRACE: Duration = Duration.ofDays(14)
    }
}
