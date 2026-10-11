package app.cetele.server.admin

import app.cetele.server.admin.audit.AuditAction
import app.cetele.server.admin.audit.AuditActorType
import app.cetele.server.admin.audit.AuditLogService
import app.cetele.server.admin.audit.AuditTargetType
import app.cetele.server.admin.audit.LoginFailureStage
import app.cetele.server.admin.totp.TotpCipher
import app.cetele.server.admin.totp.TotpService
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.UUID

/** What the console asks for next after an accepted step. */
enum class LoginStage { TOTP_VERIFY, TOTP_ENROLL, PASSWORD_CHANGE, DONE }

sealed interface LoginStepResult {
    /** [principal] is set only when [next] is [LoginStage.DONE]. */
    data class Accepted(
        val adminId: UUID,
        val email: String,
        val next: LoginStage,
        val principal: AdminPrincipal? = null,
        val startedAt: Instant? = null,
    ) : LoginStepResult

    /** [restart] means the pre-authentication must be dropped (locked, disabled or gone). */
    data class Rejected(
        val restart: Boolean,
    ) : LoginStepResult
}

sealed interface PasswordChangeResult {
    data class Changed(
        val principal: AdminPrincipal?,
    ) : PasswordChangeResult

    data class Invalid(
        val messageTr: String,
    ) : PasswordChangeResult

    data object Restart : PasswordChangeResult
}

/**
 * The admin sign-in of ADR-0033: password, then TOTP (or enrollment), then a forced password
 * change, each step under the row lock of the account and audited in the same transaction.
 * Five consecutive failures (password or TOTP) lock the account for fifteen minutes; a locked or
 * disabled account fails like a wrong password.
 */
@Service
class AdminLoginService(
    private val accounts: AdminAccountRepository,
    private val passwords: AdminPasswords,
    private val totp: TotpService,
    private val cipher: TotpCipher,
    private val audit: AuditLogService,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(AdminLoginService::class.java)

    @Transactional
    fun passwordStep(
        email: String,
        password: String,
    ): LoginStepResult {
        val normalized = normalizeEmail(email)
        val found = normalized?.let { accounts.findByEmail(it) }?.let { accounts.lockById(it.id) }
        val passwordOk = passwords.matches(password, found?.passwordHash)
        if (found == null) {
            audit.record(
                AuditActorType.ADMIN,
                null,
                AuditAction.ADMIN_LOGIN_FAILED,
                metadata = mapOf("stage" to LoginFailureStage.PASSWORD),
            )
            return LoginStepResult.Rejected(restart = true)
        }
        if (!found.enabled || found.isLocked(clock.instant().truncatedTo(ChronoUnit.MICROS))) {
            audit.record(
                AuditActorType.ADMIN,
                found.id,
                AuditAction.ADMIN_LOGIN_FAILED,
                metadata =
                    mapOf("stage" to LoginFailureStage.LOCKED),
            )
            return LoginStepResult.Rejected(restart = true)
        }
        if (!passwordOk) {
            registerFailure(found, LoginFailureStage.PASSWORD)
            return LoginStepResult.Rejected(restart = true)
        }
        val next = if (found.enrolled) LoginStage.TOTP_VERIFY else LoginStage.TOTP_ENROLL
        return LoginStepResult.Accepted(found.id, found.email, next, startedAt = clock.instant().truncatedTo(ChronoUnit.MICROS))
    }

    @Transactional
    fun totpStep(
        adminId: UUID,
        code: String,
        startedAt: Instant,
    ): LoginStepResult {
        val account = usable(adminId, startedAt) ?: return LoginStepResult.Rejected(restart = true)
        val sealed = account.totpSecretEnc
        if (!account.enrolled || sealed == null) return LoginStepResult.Rejected(restart = true)
        val secret = cipher.decrypt(sealed)
        if (secret == null) log.warn("Admin login outcome=totp_secret_unreadable")
        val step = secret?.let { totp.matchStep(it, code.trim()) }
        if (step == null || step <= (account.totpLastStep ?: Long.MIN_VALUE)) {
            val locked = registerFailure(account, LoginFailureStage.TOTP)
            return LoginStepResult.Rejected(restart = locked)
        }
        account.totpLastStep = step
        return advance(account)
    }

    @Transactional
    fun enrollStep(
        adminId: UUID,
        secret: String,
        code: String,
        startedAt: Instant,
    ): LoginStepResult {
        val account = usable(adminId, startedAt) ?: return LoginStepResult.Rejected(restart = true)
        if (account.enrolled) return LoginStepResult.Rejected(restart = true)
        val step = totp.matchStep(secret, code.trim())
        if (step == null) {
            val locked = registerFailure(account, LoginFailureStage.TOTP)
            return LoginStepResult.Rejected(restart = locked)
        }
        account.totpSecretEnc = cipher.encrypt(secret)
        account.totpEnrolledAt = clock.instant().truncatedTo(ChronoUnit.MICROS)
        account.totpLastStep = step
        audit.record(AuditActorType.ADMIN, account.id, AuditAction.ADMIN_TOTP_ENROLLED, AuditTargetType.ADMIN_USER, account.id)
        return advance(account)
    }

    /** The forced change after the first sign-in or a reset; completes the login. */
    @Transactional
    fun forcedPasswordChange(
        adminId: UUID,
        newPassword: String,
        startedAt: Instant,
    ): PasswordChangeResult {
        val account = usable(adminId, startedAt) ?: return PasswordChangeResult.Restart
        if (!account.mustChangePassword || !account.enrolled) return PasswordChangeResult.Restart
        invalidNewPassword(account, newPassword)?.let { return it }
        setPassword(account, newPassword, forced = true)
        return PasswordChangeResult.Changed(complete(account))
    }

    /** A signed-in admin changes their own password; the current one is required. */
    @Transactional
    fun changePassword(
        adminId: UUID,
        currentPassword: String,
        newPassword: String,
    ): PasswordChangeResult {
        val account = usable(adminId) ?: return PasswordChangeResult.Restart
        if (!account.enrolled) return PasswordChangeResult.Restart
        if (!passwords.matches(currentPassword, account.passwordHash)) {
            return if (registerFailure(account, LoginFailureStage.PASSWORD)) {
                PasswordChangeResult.Restart
            } else {
                PasswordChangeResult.Invalid(WRONG_CURRENT)
            }
        }
        invalidNewPassword(account, newPassword)?.let { return it }
        setPassword(account, newPassword, forced = false)
        account.failedAttempts = 0
        return PasswordChangeResult.Changed(principal(account))
    }

    @Transactional
    fun recordLogout(adminId: UUID) {
        audit.record(AuditActorType.ADMIN, adminId, AuditAction.ADMIN_LOGGED_OUT)
    }

    /** The enabled, unlocked account of a pending login, or `null` (audited as a locked failure). */
    private fun usable(
        adminId: UUID,
        startedAt: Instant? = null,
    ): AdminAccount? {
        val account = accounts.lockById(adminId) ?: return null
        if (startedAt != null && account.passwordChangedAt?.isAfter(startedAt) == true) return null
        if (!account.enabled || account.isLocked(clock.instant().truncatedTo(ChronoUnit.MICROS))) {
            audit.record(
                AuditActorType.ADMIN,
                account.id,
                AuditAction.ADMIN_LOGIN_FAILED,
                metadata =
                    mapOf("stage" to LoginFailureStage.LOCKED),
            )
            return null
        }
        return account
    }

    private fun advance(account: AdminAccount): LoginStepResult.Accepted =
        if (account.mustChangePassword) {
            LoginStepResult.Accepted(account.id, account.email, LoginStage.PASSWORD_CHANGE)
        } else {
            LoginStepResult.Accepted(account.id, account.email, LoginStage.DONE, complete(account))
        }

    private fun complete(account: AdminAccount): AdminPrincipal {
        account.failedAttempts = 0
        account.lockedUntil = null
        account.lastLoginAt = clock.instant().truncatedTo(ChronoUnit.MICROS)
        audit.record(AuditActorType.ADMIN, account.id, AuditAction.ADMIN_LOGIN_SUCCEEDED)
        return principal(account)
    }

    private fun principal(account: AdminAccount): AdminPrincipal =
        AdminPrincipal(account.id, account.email, account.role, clock.instant().truncatedTo(ChronoUnit.MICROS))

    /** Counts a failure; returns `true` when it locked the account. */
    private fun registerFailure(
        account: AdminAccount,
        stage: LoginFailureStage,
    ): Boolean {
        account.failedAttempts += 1
        audit.record(AuditActorType.ADMIN, account.id, AuditAction.ADMIN_LOGIN_FAILED, metadata = mapOf("stage" to stage))
        if (account.failedAttempts < MAX_FAILURES) return false
        val until = clock.instant().truncatedTo(ChronoUnit.MICROS).plus(LOCKOUT)
        account.failedAttempts = 0
        account.lockedUntil = until
        audit.record(
            AuditActorType.ADMIN,
            account.id,
            AuditAction.ADMIN_LOCKED_OUT,
            AuditTargetType.ADMIN_USER,
            account.id,
            mapOf("until" to until),
        )
        log.info("Admin login outcome=locked_out")
        return true
    }

    private fun invalidNewPassword(
        account: AdminAccount,
        newPassword: String,
    ): PasswordChangeResult.Invalid? {
        if (!passwords.isAcceptable(newPassword)) return PasswordChangeResult.Invalid(LENGTH)
        if (passwords.matches(newPassword, account.passwordHash)) return PasswordChangeResult.Invalid(SAME_AS_CURRENT)
        return null
    }

    private fun setPassword(
        account: AdminAccount,
        newPassword: String,
        forced: Boolean,
    ) {
        account.passwordHash = passwords.hash(newPassword)
        account.mustChangePassword = false
        account.passwordChangedAt = clock.instant().truncatedTo(ChronoUnit.MICROS)
        audit.record(
            AuditActorType.ADMIN,
            account.id,
            AuditAction.ADMIN_PASSWORD_CHANGED,
            AuditTargetType.ADMIN_USER,
            account.id,
            mapOf("forced" to forced),
        )
    }

    companion object {
        const val MAX_FAILURES = 5
        val LOCKOUT: Duration = Duration.ofMinutes(15)
        const val LENGTH = "Parola 12 ile 128 karakter arasında olmalı."
        const val SAME_AS_CURRENT = "Yeni parola mevcut paroladan farklı olmalı."
        const val WRONG_CURRENT = "Mevcut parola doğru değil."
        private val EMAIL = Regex("^[^@\\s]+@[^@\\s]+$")

        /** Lowercase, trimmed and in the shape of `admin_users_email_format`, or `null`. */
        fun normalizeEmail(email: String): String? {
            val normalized = email.trim().lowercase(Locale.ROOT)
            return normalized.takeIf { it.length in 3..254 && EMAIL.matches(it) }
        }
    }
}
