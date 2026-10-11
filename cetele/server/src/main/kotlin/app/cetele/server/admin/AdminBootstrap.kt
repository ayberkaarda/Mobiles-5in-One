package app.cetele.server.admin

import app.cetele.server.admin.audit.AuditAction
import app.cetele.server.admin.audit.AuditActorType
import app.cetele.server.admin.audit.AuditLogService
import app.cetele.server.admin.audit.AuditTargetType
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock

/**
 * Creates the first `ADMIN` (ADR-0033): only when no enabled `ADMIN` exists and both bootstrap
 * variables are set. The account must change its password and enroll TOTP at the first login.
 * An existing row with the same email (for example one the operator disabled after losing the
 * last authenticator) is reset to that state instead. Otherwise the variables are ignored.
 */
@Service
class AdminBootstrapService(
    private val accounts: AdminAccountRepository,
    private val passwords: AdminPasswords,
    private val audit: AuditLogService,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(AdminBootstrapService::class.java)

    @Transactional
    fun bootstrap(
        email: String,
        password: String,
    ): Boolean {
        if (email.isBlank() || password.isEmpty()) return false
        if (accounts.lockEnabledAdmins().isNotEmpty()) {
            log.info("Admin bootstrap outcome=skipped reason=enabled_admin_exists")
            return false
        }
        val normalized =
            checkNotNull(AdminLoginService.normalizeEmail(email)) { "CETELE_ADMIN_BOOTSTRAP_EMAIL is not a valid email address" }
        check(passwords.isAcceptable(password)) { "CETELE_ADMIN_BOOTSTRAP_PASSWORD must be 12 to 128 characters" }
        val existing = accounts.findByEmail(normalized)?.let { accounts.lockById(it.id) }
        val account =
            if (existing == null) {
                accounts.save(AdminAccount(normalized, passwords.hash(password), AdminRole.ADMIN, null, clock.instant()))
            } else {
                existing.passwordHash = passwords.hash(password)
                existing.role = AdminRole.ADMIN
                existing.disabledAt = null
                existing.lockedUntil = null
                existing.failedAttempts = 0
                existing.clearTotp()
                existing
            }
        account.mustChangePassword = true
        audit.record(
            AuditActorType.SYSTEM,
            null,
            AuditAction.ADMIN_BOOTSTRAPPED,
            AuditTargetType.ADMIN_USER,
            account.id,
            mapOf("role" to AdminRole.ADMIN),
        )
        log.info("Admin bootstrap outcome=created")
        return true
    }
}

@Component
class AdminBootstrapRunner(
    private val properties: AdminProperties,
    private val service: AdminBootstrapService,
) : ApplicationRunner {
    override fun run(args: ApplicationArguments) {
        service.bootstrap(properties.bootstrapEmail, properties.bootstrapPassword)
    }
}
