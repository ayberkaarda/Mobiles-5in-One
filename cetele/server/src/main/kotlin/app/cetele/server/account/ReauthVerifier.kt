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

@Service
class ReauthVerifier(
    private val users: UserStore,
    private val otp: OtpService,
    private val limiter: RateLimiter,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx =
        TransactionTemplate(transactionManager).apply {
            propagationBehavior = TransactionDefinition.PROPAGATION_REQUIRES_NEW
        }

    fun request(caller: CurrentUser) {
        limiter.consume(RateLimit.REAUTH_REQUEST_USER, caller.userId.toString())
        val phone = phone(caller)
        limiter.consume(RateLimit.OTP_REQUEST_PHONE, RateLimiter.phoneSubject(phone))
        val text = tx.execute { otp.issue(phone, caller.deviceId, OtpPurpose.REAUTH, clock.instant()) }
        otp.deliver(phone, text)
    }

    fun require(
        caller: CurrentUser,
        code: String,
        now: Instant,
    ) {
        limiter.consume(RateLimit.REAUTH_VERIFY_USER, caller.userId.toString())
        val phone = phone(caller)
        val result = tx.execute { otp.check(phone, caller.deviceId, OtpPurpose.REAUTH, code, now) }
        if (result !is OtpCheck.Accepted) throw ProblemException(ProblemCode.AUTH_REAUTH_INVALID)
    }

    private fun phone(caller: CurrentUser): String =
        users.findById(caller.userId)?.takeIf { it.active }?.phoneE164
            ?: throw ProblemException(ProblemCode.AUTH_UNAUTHENTICATED)
}
