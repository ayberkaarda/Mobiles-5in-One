package app.cetele.server.admin.console

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

/**
 * The console's own mapping of `users` (the auth module reads the table with plain SQL). Only
 * the columns the console shows or changes; rows are never created or deleted through it.
 */
@Entity(name = "ConsoleUser")
@Table(name = "users")
class ConsoleUser(
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    val id: UUID,
    @Column(name = "phone_e164", nullable = false, insertable = false, updatable = false)
    val phoneE164: String,
    @Column(name = "display_name", insertable = false, updatable = false)
    val displayName: String?,
    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    val createdAt: Instant,
    @Column(name = "deactivated_at", insertable = false)
    val deactivatedAt: Instant?,
)
