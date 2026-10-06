package app.cetele.server.sync.changelog

import app.cetele.server.tenancy.TenantScoped
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "change_log")
class ChangeLogRow(
    @Id val id: UUID,
    @Column(name = "shop_id", nullable = false) override val shopId: UUID,
    val seq: Long,
    val entity: String,
    @Column(name = "entity_id", nullable = false) val entityId: UUID,
    val op: String,
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) val payload: String,
    val at: Instant,
) : TenantScoped
