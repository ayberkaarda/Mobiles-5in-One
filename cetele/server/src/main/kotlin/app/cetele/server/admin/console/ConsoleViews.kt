package app.cetele.server.admin.console

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

/** Dates on console pages: `dd.MM.yyyy HH:mm` in Europe/Istanbul, `-` when absent. */
object ConsoleFormat {
    private val formatter: DateTimeFormatter = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm").withZone(ZoneId.of("Europe/Istanbul"))

    fun time(instant: Instant?): String = instant?.let { formatter.format(it) } ?: "-"
}

data class DashboardView(
    val shops: Long,
    val users: Long,
    val proShops: Long,
)

data class ShopRowView(
    val id: UUID,
    val name: String,
    val type: String,
    val il: String,
    val ilce: String,
    val plan: String,
    val createdAt: String,
    val deletedAt: String?,
)

data class MemberView(
    val userId: UUID,
    val role: String,
    val maskedPhone: String,
    val deactivated: Boolean,
)

/** Shop page: metadata and counts only, never ledger content, photos or customer data. */
data class ShopDetailView(
    val shop: ShopRowView,
    val deletionRequestedAt: String?,
    val deletionGraceUntil: String?,
    val members: List<MemberView>,
    val liveCustomers: Long,
    val entries: Long,
    val readyPhotos: Long,
    val smsMonth: String,
    val smsUsed: Int,
    val ownerDeactivated: Boolean,
) {
    val memberCount: Int get() = members.size
    val ownerCount: Int get() = members.count { it.role == "OWNER" }
    val staffCount: Int get() = members.count { it.role == "STAFF" }
}

data class UserRowView(
    val id: UUID,
    val maskedPhone: String,
    val displayName: String?,
    val createdAt: String,
    val deactivatedAt: String?,
) {
    val deactivated: Boolean get() = deactivatedAt != null
}

data class UserMembershipView(
    val shopId: UUID,
    val shopName: String,
    val role: String,
    val shopDeleted: Boolean,
)

data class DeviceView(
    val id: UUID,
    val model: String,
    val appVersion: String,
    val lastSeenAt: String,
    val integrityVerifiedAt: String,
    val liveSessions: Long,
)

data class UserDetailView(
    val user: UserRowView,
    val memberships: List<UserMembershipView>,
    val devices: List<DeviceView>,
)
