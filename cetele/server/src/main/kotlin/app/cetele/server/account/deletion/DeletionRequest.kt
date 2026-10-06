package app.cetele.server.account.deletion

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UuidGenerator
import java.time.Instant
import java.util.UUID

enum class DeletionKind { ACCOUNT, SHOP }

@Entity
@Table(name = "deletion_requests")
class DeletionRequest(
    @Id @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    var id: UUID? = null,
    @Enumerated(EnumType.STRING) @Column(nullable = false)
    val kind: DeletionKind,
    @Column(name = "user_id", nullable = false)
    val userId: UUID,
    @Column(name = "shop_id")
    val shopId: UUID? = null,
    @Column(name = "requested_at", nullable = false)
    val requestedAt: Instant,
    @Column(name = "grace_until", nullable = false)
    val graceUntil: Instant,
    @Column(name = "cancelled_at")
    var cancelledAt: Instant? = null,
    @Column(name = "blocked_at")
    var blockedAt: Instant? = null,
    @Column(name = "completed_at")
    var completedAt: Instant? = null,
    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = requestedAt,
)
