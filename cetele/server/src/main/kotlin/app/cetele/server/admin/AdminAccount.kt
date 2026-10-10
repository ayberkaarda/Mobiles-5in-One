package app.cetele.server.admin

import app.cetele.server.security.TraceIdFilter
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.LockModeType
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.Repository
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

/** Platform staff role. `SUPPORT` reads, `ADMIN` also acts (ADR-0033). */
enum class AdminRole {
    ADMIN,
    SUPPORT,
    ;

    val authority: String get() = "ROLE_$name"
}

/** A row of `admin_users`. It has no link to `users`: an admin never signs in to `/v1`. */
@Entity
@Table(name = "admin_users")
class AdminAccount(
    @Column(name = "email", nullable = false, updatable = false)
    val email: String,
    @Column(name = "password_hash", nullable = false)
    var passwordHash: String,
    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false)
    var role: AdminRole,
    @Column(name = "created_by", updatable = false)
    val createdBy: UUID?,
    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant,
) {
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    val id: UUID = TraceIdFilter.uuidV7()

    @Column(name = "totp_secret_enc")
    var totpSecretEnc: ByteArray? = null

    @Column(name = "totp_enrolled_at")
    var totpEnrolledAt: Instant? = null

    @Column(name = "totp_last_step")
    var totpLastStep: Long? = null

    @Column(name = "must_change_password", nullable = false)
    var mustChangePassword: Boolean = true

    @Column(name = "failed_attempts", nullable = false)
    var failedAttempts: Int = 0

    @Column(name = "locked_until")
    var lockedUntil: Instant? = null

    @Column(name = "last_login_at")
    var lastLoginAt: Instant? = null

    @Column(name = "password_changed_at")
    var passwordChangedAt: Instant? = null

    @Column(name = "disabled_at")
    var disabledAt: Instant? = null

    val enrolled: Boolean get() = totpEnrolledAt != null && totpSecretEnc != null

    val enabled: Boolean get() = disabledAt == null

    fun isLocked(now: Instant): Boolean = lockedUntil?.isAfter(now) == true

    fun clearTotp() {
        totpSecretEnc = null
        totpEnrolledAt = null
        totpLastStep = null
    }
}

interface AdminAccountRepository : Repository<AdminAccount, UUID> {
    fun save(account: AdminAccount): AdminAccount

    fun findById(id: UUID): AdminAccount?

    fun findByEmail(email: String): AdminAccount?

    /** Login and every change of one admin run under its row lock. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM AdminAccount a WHERE a.id = :id")
    fun lockById(
        @Param("id") id: UUID,
    ): AdminAccount?

    /** Locks every enabled `ADMIN`, so "the last enabled ADMIN" cannot change under a check. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM AdminAccount a WHERE a.role = app.cetele.server.admin.AdminRole.ADMIN AND a.disabledAt IS NULL ORDER BY a.id")
    fun lockEnabledAdmins(): List<AdminAccount>

    @Query("SELECT count(a) FROM AdminAccount a WHERE a.role = app.cetele.server.admin.AdminRole.ADMIN AND a.disabledAt IS NULL")
    fun countEnabledAdmins(): Long

    @Query("SELECT a FROM AdminAccount a ORDER BY a.createdAt, a.id")
    fun findAllOrdered(): List<AdminAccount>
}
