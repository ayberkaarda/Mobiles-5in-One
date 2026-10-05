package app.cetele.server.auth.device

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UuidGenerator
import org.springframework.data.repository.Repository
import org.springframework.stereotype.Service
import java.time.Instant
import java.util.UUID

/** A device a user signed in from; `deviceId` is the id the app creates, carried as `did` in tokens. */
@Entity
@Table(name = "devices")
class Device(
    @Column(name = "user_id", nullable = false, updatable = false)
    val userId: UUID,
    @Column(name = "device_id", nullable = false, updatable = false)
    val deviceId: UUID,
    @Column(name = "model", nullable = false)
    var model: String,
    @Column(name = "app_version", nullable = false)
    var appVersion: String,
    @Column(name = "last_seen_at", nullable = false)
    var lastSeenAt: Instant,
    @Column(name = "integrity_verified_at")
    var integrityVerifiedAt: Instant?,
    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant,
) {
    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    var id: UUID? = null
}

interface DeviceRepository : Repository<Device, UUID> {
    fun save(device: Device): Device

    fun findByUserIdAndDeviceId(
        userId: UUID,
        deviceId: UUID,
    ): Device?
}

/** Keeps the `devices` rows current. Callers run inside their own transaction. */
@Service
class DeviceService(
    private val devices: DeviceRepository,
) {
    /** Records a sign-in: creates or updates the row of ([userId], [deviceId]). */
    fun recordSignIn(
        userId: UUID,
        deviceId: UUID,
        model: String,
        appVersion: String,
        integrityVerifiedAt: Instant,
        now: Instant,
    ): Device {
        val existing = devices.findByUserIdAndDeviceId(userId, deviceId)
        if (existing == null) {
            return devices.save(Device(userId, deviceId, model, appVersion, now, integrityVerifiedAt, now))
        }
        existing.model = model
        existing.appVersion = appVersion
        existing.lastSeenAt = now
        existing.integrityVerifiedAt = integrityVerifiedAt
        return existing
    }

    fun touch(
        userId: UUID,
        deviceId: UUID,
        now: Instant,
    ) {
        devices.findByUserIdAndDeviceId(userId, deviceId)?.lastSeenAt = now
    }
}
