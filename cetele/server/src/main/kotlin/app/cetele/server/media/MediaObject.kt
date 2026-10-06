package app.cetele.server.media

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UuidGenerator
import java.time.Instant
import java.util.UUID

enum class MediaStatus { PENDING, READY, FAILED, EXPIRED }

@Entity
@Table(name = "media_objects")
class MediaObject(
    @Column(name = "shop_id", nullable = false, updatable = false)
    override val shopId: UUID,
    @Column(name = "declared_content_type", nullable = false, updatable = false)
    val declaredContentType: String,
    @Column(name = "declared_length", nullable = false, updatable = false)
    val declaredLength: Int,
    @Column(name = "created_by", updatable = false)
    val createdBy: UUID?,
    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant,
    @Column(name = "upload_expires_at", nullable = false, updatable = false)
    val uploadExpiresAt: Instant,
) : TenantScoped {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    var id: UUID? = null

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    var status: MediaStatus = MediaStatus.PENDING

    @Column(name = "upload_key", nullable = false)
    var uploadKey: String = ""

    @Column(name = "photo_key")
    var photoKey: String? = null

    var width: Int? = null
    var height: Int? = null
    var bytes: Int? = null

    @Column(name = "failure_code")
    var failureCode: String? = null

    @Column(name = "ready_at")
    var readyAt: Instant? = null
}
