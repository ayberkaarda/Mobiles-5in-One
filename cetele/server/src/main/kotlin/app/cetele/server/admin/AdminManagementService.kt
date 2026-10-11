package app.cetele.server.admin

import app.cetele.server.admin.audit.AuditAction
import app.cetele.server.admin.audit.AuditActorType
import app.cetele.server.admin.audit.AuditLogService
import app.cetele.server.admin.audit.AuditTargetType
import app.cetele.server.admin.console.ConsoleFormat
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/** A row of the admin list. Never the password hash or the TOTP secret. */
data class AdminAccountView(
    val id: UUID,
    val email: String,
    val role: String,
    val enrolled: Boolean,
    val mustChangePassword: Boolean,
    val locked: Boolean,
    val disabled: Boolean,
    val lastLoginAt: String,
    val createdAt: String,
)

/** An account and its one-time password, shown once to the acting `ADMIN`. */
data class CreatedAdmin(
    val id: UUID,
    val email: String,
    val role: AdminRole,
    val oneTimePassword: String,
)

/**
 * Management of `admin_users` by an `ADMIN`. An admin cannot disable, demote or reset
 * themselves, and the last enabled `ADMIN` cannot be disabled or demoted (409).
 */
@Service
class AdminManagementService(
    private val accounts: AdminAccountRepository,
    private val passwords: AdminPasswords,
    private val audit: AuditLogService,
    private val clock: Clock,
) {
    @Transactional(readOnly = true)
    fun list(): List<AdminAccountView> {
        val now = clock.instant()
        return accounts.findAllOrdered().map {
            AdminAccountView(
                id = it.id,
                email = it.email,
                role = it.role.name,
                enrolled = it.enrolled,
                mustChangePassword = it.mustChangePassword,
                locked = it.isLocked(now),
                disabled = !it.enabled,
                lastLoginAt = ConsoleFormat.time(it.lastLoginAt),
                createdAt = ConsoleFormat.time(it.createdAt),
            )
        }
    }

    @Transactional
    fun create(
        actor: AdminPrincipal,
        email: String,
        role: AdminRole,
    ): CreatedAdmin {
        val normalized = AdminLoginService.normalizeEmail(email) ?: throw AdminConflictException(INVALID_EMAIL)
        if (accounts.findByEmail(normalized) != null) throw AdminConflictException(EMAIL_TAKEN)
        val oneTime = passwords.oneTimePassword()
        val account = accounts.save(AdminAccount(normalized, passwords.hash(oneTime), role, actor.id, clock.instant()))
        audit.record(
            AuditActorType.ADMIN,
            actor.id,
            AuditAction.ADMIN_USER_CREATED,
            AuditTargetType.ADMIN_USER,
            account.id,
            mapOf("role" to role),
        )
        return CreatedAdmin(account.id, account.email, role, oneTime)
    }

    @Transactional
    fun changeRole(
        actor: AdminPrincipal,
        targetId: UUID,
        role: AdminRole,
    ) {
        refuseSelf(actor, targetId)
        val enabledAdmins = accounts.lockEnabledAdmins()
        val target = accounts.lockById(targetId) ?: throw AdminNotFoundException()
        val from = target.role
        if (from == role) return
        if (from == AdminRole.ADMIN && target.enabled && enabledAdmins.size <= 1) throw AdminConflictException(LAST_ADMIN)
        target.role = role
        audit.record(
            AuditActorType.ADMIN,
            actor.id,
            AuditAction.ADMIN_USER_ROLE_CHANGED,
            AuditTargetType.ADMIN_USER,
            target.id,
            mapOf("from" to from, "to" to role),
        )
    }

    @Transactional
    fun disable(
        actor: AdminPrincipal,
        targetId: UUID,
    ) {
        refuseSelf(actor, targetId)
        val enabledAdmins = accounts.lockEnabledAdmins()
        val target = accounts.lockById(targetId) ?: throw AdminNotFoundException()
        if (!target.enabled) return
        if (target.role == AdminRole.ADMIN && enabledAdmins.size <= 1) throw AdminConflictException(LAST_ADMIN)
        target.disabledAt = clock.instant()
        audit.record(AuditActorType.ADMIN, actor.id, AuditAction.ADMIN_USER_DISABLED, AuditTargetType.ADMIN_USER, target.id)
    }

    @Transactional
    fun enable(
        actor: AdminPrincipal,
        targetId: UUID,
    ) {
        refuseSelf(actor, targetId)
        val target = accounts.lockById(targetId) ?: throw AdminNotFoundException()
        if (target.enabled) return
        target.disabledAt = null
        target.failedAttempts = 0
        target.lockedUntil = null
        audit.record(AuditActorType.ADMIN, actor.id, AuditAction.ADMIN_USER_ENABLED, AuditTargetType.ADMIN_USER, target.id)
    }

    /** Replaces the password and clears the authenticator for a fresh enrollment. */
    @Transactional
    fun resetTotp(
        actor: AdminPrincipal,
        targetId: UUID,
    ): CreatedAdmin {
        refuseSelf(actor, targetId)
        val target = accounts.lockById(targetId) ?: throw AdminNotFoundException()
        val oneTime = passwords.oneTimePassword()
        target.passwordHash = passwords.hash(oneTime)
        target.passwordChangedAt = clock.instant().truncatedTo(ChronoUnit.MICROS)
        target.mustChangePassword = true
        target.clearTotp()
        audit.record(AuditActorType.ADMIN, actor.id, AuditAction.ADMIN_TOTP_RESET, AuditTargetType.ADMIN_USER, target.id)
        return CreatedAdmin(target.id, target.email, target.role, oneTime)
    }

    /** Whether the account and its credentials still match the signed-in [principal]. */
    @Transactional(readOnly = true)
    fun isCurrent(principal: AdminPrincipal): Boolean {
        val account = accounts.findById(principal.id) ?: return false
        return account.enabled && account.role == principal.role && account.enrolled &&
            !account.isLocked(clock.instant()) &&
            account.passwordChangedAt?.isAfter(principal.authenticatedAt) != true &&
            account.totpEnrolledAt?.isAfter(principal.authenticatedAt) != true
    }

    @Transactional(readOnly = true)
    fun isPendingCurrent(
        adminId: UUID,
        startedAt: Instant,
    ): Boolean {
        val account = accounts.findById(adminId) ?: return false
        return account.enabled && !account.isLocked(clock.instant()) &&
            account.passwordChangedAt?.isAfter(startedAt) != true
    }

    private fun refuseSelf(
        actor: AdminPrincipal,
        targetId: UUID,
    ) {
        if (actor.id == targetId) throw AdminConflictException(SELF)
    }

    companion object {
        const val SELF = "Kendi hesabınızda bu işlemi yapamazsınız."
        const val LAST_ADMIN = "Son etkin yönetici devre dışı bırakılamaz veya rolü değiştirilemez."
        const val EMAIL_TAKEN = "Bu e-posta adresiyle bir yönetici hesabı zaten var."
        const val INVALID_EMAIL = "Geçerli bir e-posta adresi girin."
    }
}
