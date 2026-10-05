package app.cetele.server.auth

import app.cetele.server.auth.device.DeviceService
import app.cetele.server.auth.integrity.IntegrityGate
import app.cetele.server.auth.otp.OtpCheck
import app.cetele.server.auth.otp.OtpService
import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.auth.token.RefreshTokenService
import app.cetele.server.auth.token.RotationResult
import app.cetele.server.config.logging.Masking
import app.cetele.server.security.CurrentUser
import app.cetele.server.security.JwtCodec
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.util.UUID

/** Tokens handed to the client after a sign-in or a refresh. */
data class SessionTokens(
    val accessToken: String,
    val expiresIn: Long,
    val refreshToken: String,
)

data class SignIn(
    val tokens: SessionTokens,
    val userId: UUID,
    val displayName: String?,
    val isNewUser: Boolean,
)

/**
 * The sign-in flows. Failures that must be remembered (an OTP attempt, a family revoked on reuse)
 * are committed before the error response is thrown, so each flow runs its own
 * [TransactionTemplate] instead of a declarative transaction that would roll them back.
 * Logs carry the masked phone and the outcome only.
 */
@Service
class AuthService(
    private val integrity: IntegrityGate,
    private val limiter: RateLimiter,
    private val otp: OtpService,
    private val users: UserStore,
    private val devices: DeviceService,
    private val refreshTokens: RefreshTokenService,
    private val jwt: JwtCodec,
    private val tx: TransactionTemplate,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(AuthService::class.java)

    /**
     * `POST /v1/auth/otp/request`. The IP limit comes first (cheapest refusal); the phone limit is
     * charged only after a valid integrity verdict, so scripts without one cannot lock a number
     * out. Known and unknown numbers take the same path: users are not looked at here.
     */
    fun requestOtp(
        phoneE164: String,
        deviceId: UUID,
        integrityToken: String?,
        clientIp: String,
    ) {
        limiter.consume(RateLimit.OTP_REQUEST_IP, clientIp)
        integrity.require(integrityToken, phoneE164, deviceId)
        limiter.consume(RateLimit.OTP_REQUEST_PHONE, RateLimiter.phoneSubject(phoneE164))
        val text = tx.execute { otp.issue(phoneE164, deviceId, clock.instant()) }!!
        otp.deliver(phoneE164, text)
        log.info("OTP request phone={} outcome=sent", Masking.phone(phoneE164))
    }

    /** `POST /v1/auth/otp/verify`. Every refusal is the same 401 `auth.otp_invalid`. */
    fun verifyOtp(
        phoneE164: String,
        deviceId: UUID,
        code: String,
        model: String,
        appVersion: String,
        clientIp: String,
    ): SignIn {
        limiter.consume(RateLimit.OTP_VERIFY_IP, clientIp)
        val now = clock.instant()
        val result =
            tx.execute {
                when (val check = otp.check(phoneE164, deviceId, code, now)) {
                    OtpCheck.Rejected -> {
                        null
                    }

                    is OtpCheck.Accepted -> {
                        val (user, created) = users.findOrCreate(phoneE164)
                        if (!user.active) {
                            null
                        } else {
                            devices.recordSignIn(user.id, deviceId, model, appVersion, check.issuedAt, now)
                            val refresh = refreshTokens.issueFamily(user.id, deviceId, now)
                            Triple(user, created, refresh.token)
                        }
                    }
                }
            }
        if (result == null) {
            log.info("OTP verify phone={} outcome=rejected", Masking.phone(phoneE164))
            throw ProblemException(ProblemCode.AUTH_OTP_INVALID)
        }
        val (user, created, refreshToken) = result
        log.info("OTP verify phone={} outcome=signed_in new_user={}", Masking.phone(phoneE164), created)
        return SignIn(
            tokens = SessionTokens(jwt.issue(user.id, deviceId, now), jwt.expiresInSeconds, refreshToken),
            userId = user.id,
            displayName = user.displayName,
            isNewUser = created,
        )
    }

    /**
     * `POST /v1/auth/refresh`. Limited per device once the token is known, per IP otherwise. A
     * reused token revokes its family (committed) and is answered like any invalid token.
     */
    fun refresh(
        refreshToken: String,
        clientIp: String,
    ): SessionTokens {
        val now = clock.instant()
        val outcome =
            tx.execute {
                val current = refreshTokens.lookup(refreshToken)
                if (current == null) {
                    RotationResult.Unknown
                } else {
                    limiter.consume(RateLimit.REFRESH_DEVICE, current.deviceId.toString())
                    val active = users.findById(current.userId)?.active == true
                    val rotation = refreshTokens.rotate(current, active, now)
                    if (rotation is RotationResult.Rotated) devices.touch(current.userId, current.deviceId, now)
                    rotation
                }
            }!!
        return when (outcome) {
            is RotationResult.Rotated -> {
                log.info("Refresh outcome=rotated")
                val row = outcome.issued.row
                SessionTokens(jwt.issue(row.userId, row.deviceId, now), jwt.expiresInSeconds, outcome.issued.token)
            }

            RotationResult.Unknown -> {
                limiter.consume(RateLimit.REFRESH_IP, clientIp)
                log.info("Refresh outcome=unknown_token")
                throw ProblemException(ProblemCode.AUTH_REFRESH_INVALID)
            }

            RotationResult.ReuseDetected -> {
                log.warn("Refresh outcome=reuse_detected family_revoked=true")
                throw ProblemException(ProblemCode.AUTH_REFRESH_INVALID)
            }

            RotationResult.Rejected -> {
                log.info("Refresh outcome=rejected")
                throw ProblemException(ProblemCode.AUTH_REFRESH_INVALID)
            }
        }
    }

    /** `POST /v1/auth/logout`: revokes every refresh token of the caller's device. */
    fun logout(caller: CurrentUser) {
        val revoked = tx.execute { refreshTokens.revokeDevice(caller.userId, caller.deviceId, clock.instant()) }
        log.info("Logout outcome=revoked tokens={}", revoked)
    }
}
