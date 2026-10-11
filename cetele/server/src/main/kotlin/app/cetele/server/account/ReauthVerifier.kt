package app.cetele.server.account

import app.cetele.server.auth.UserStore
import app.cetele.server.auth.otp.OtpCheck
import app.cetele.server.auth.otp.OtpPurpose
import app.cetele.server.auth.otp.OtpService
import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.security.CurrentUser
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Instant
import java.util.UUID

enum class ReauthAction(
    val smsText: String,
) {
    ACCOUNT_DELETE("hesabınızın silinmesi"),
    SHOP_DELETE("dükkân silme"),
    OWNERSHIP_TRANSFER("dükkân devri"),
    DEVICE_SIGN_OUT("bir cihazın oturumunu kapatma"),
    ;

    fun scope(shopId: UUID? = null): String =
        when (this) {
            SHOP_DELETE, OWNERSHIP_TRANSFER -> "$name:${checkNotNull(shopId)}"
            ACCOUNT_DELETE, DEVICE_SIGN_OUT -> name
        }
}

@Service
class ReauthVerifier(
    private val users: UserStore,
    private val store: AccountStore,
    private val otp: OtpService,
    private val limiter: RateLimiter,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx =
        TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }

    fun request(
        caller: CurrentUser,
        action: ReauthAction,
        shopId: UUID? = null,
    ) {
        val shopAction = action == ReauthAction.SHOP_DELETE || action == ReauthAction.OWNERSHIP_TRANSFER
        if (shopAction && (shopId == null || !store.ownsActiveShop(shopId, caller.userId))) {
            throw ProblemException(ProblemCode.NOT_FOUND)
        }
        limiter.consume(RateLimit.REAUTH_REQUEST_USER, caller.userId.toString())
        val phone = phone(caller)
        val text = checkNotNull(tx.execute { otp.issue(phone, caller.deviceId, OtpPurpose.REAUTH, clock.instant(), action.scope(shopId)) })
        otp.deliver(phone, text)
    }

    fun require(
        caller: CurrentUser,
        code: String,
        now: Instant,
        scope: String,
    ) {
        limiter.consume(RateLimit.REAUTH_VERIFY_USER, caller.userId.toString())
        val phone = phone(caller)
        val result = tx.execute { otp.check(phone, caller.deviceId, OtpPurpose.REAUTH, code, now, scope) }
        if (result !is OtpCheck.Accepted) throw ProblemException(ProblemCode.AUTH_REAUTH_INVALID)
    }

    private fun phone(caller: CurrentUser): String =
        users.findById(caller.userId)?.takeIf { it.active }?.phoneE164
            ?: throw ProblemException(ProblemCode.AUTH_UNAUTHENTICATED)
}
