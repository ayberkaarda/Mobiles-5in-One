package app.cetele.server.admin.audit

import app.cetele.server.security.TraceIdFilter
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.domain.Pageable
import org.springframework.data.domain.Slice
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.Repository
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

enum class AuditActorType { ADMIN, SYSTEM }

enum class AuditTargetType { ADMIN_USER, USER, SHOP, DEVICE }

/**
 * Every audited action of ADR-0033 with the only `metadata` keys it may carry. Metadata never
 * holds a phone, an email, a name, a note, a token, a password, a TOTP code or a search term.
 */
enum class AuditAction(
    val metadataKeys: Set<String>,
) {
    ADMIN_BOOTSTRAPPED(setOf("role")),
    ADMIN_LOGIN_SUCCEEDED(emptySet()),
    ADMIN_LOGIN_FAILED(setOf("stage")),
    ADMIN_LOCKED_OUT(setOf("until")),
    ADMIN_LOGGED_OUT(emptySet()),
    ADMIN_TOTP_ENROLLED(emptySet()),
    ADMIN_TOTP_RESET(emptySet()),
    ADMIN_PASSWORD_CHANGED(setOf("forced")),
    ADMIN_USER_CREATED(setOf("role")),
    ADMIN_USER_ROLE_CHANGED(setOf("from", "to")),
    ADMIN_USER_DISABLED(emptySet()),
    ADMIN_USER_ENABLED(emptySet()),
    SHOP_SEARCHED(setOf("results")),
    SHOP_VIEWED(emptySet()),
    USER_SEARCHED(setOf("results")),
    USER_VIEWED(emptySet()),
    USER_DEACTIVATED(setOf("revokedSessions")),
    USER_REACTIVATED(emptySet()),
    DEVICE_REVOKED(setOf("revokedSessions")),
    AUDIT_LOG_VIEWED(setOf("page")),
}

/** Stage of a failed admin sign-in, the only metadata of `ADMIN_LOGIN_FAILED`. */
enum class LoginFailureStage { PASSWORD, TOTP, LOCKED }

/** One append-only row of `audit_logs`. The admin package never updates or deletes a row except retention. */
@Entity
@Table(name = "audit_logs")
class AuditLog(
    @Column(name = "at", nullable = false, updatable = false)
    val at: Instant,
    @Enumerated(EnumType.STRING)
    @Column(name = "actor_type", nullable = false, updatable = false)
    val actorType: AuditActorType,
    @Column(name = "actor_id", updatable = false)
    val actorId: UUID?,
    @Column(name = "action", nullable = false, updatable = false)
    val action: String,
    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", updatable = false)
    val targetType: AuditTargetType?,
    @Column(name = "target_id", updatable = false)
    val targetId: UUID?,
    @Column(name = "ip_hash", updatable = false)
    val ipHash: String?,
    @Column(name = "trace_id", updatable = false)
    val traceId: UUID?,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb", nullable = false, updatable = false)
    val metadata: String,
) {
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    val id: UUID = TraceIdFilter.uuidV7()
}

interface AuditLogRepository : Repository<AuditLog, UUID> {
    fun save(row: AuditLog): AuditLog

    @Query("SELECT a FROM AuditLog a ORDER BY a.at DESC, a.id DESC")
    fun findPage(pageable: Pageable): Slice<AuditLog>

    @Query("SELECT count(a) FROM AuditLog a")
    fun countAll(): Long

    /** The retention job: rows older than [cutoff]. */
    @Modifying
    @Query("DELETE FROM AuditLog a WHERE a.at < :cutoff")
    fun deleteOlderThan(
        @Param("cutoff") cutoff: Instant,
    ): Int
}
