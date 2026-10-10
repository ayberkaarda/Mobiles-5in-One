@file:UseSerializers(InstantSerializer::class, LocalDateSerializer::class)

package app.cetele.android.core.network.dto.me

import app.cetele.android.core.network.dto.InstantSerializer
import app.cetele.android.core.network.dto.LocalDateSerializer
import app.cetele.android.core.network.dto.ShopRole
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import java.time.Instant

@Serializable
data class Me(
    val id: String,
    val phone: String,
    val displayName: String? = null,
    val memberships: List<MembershipSummary>,
    val deletion: DeletionStatus? = null,
)

@Serializable
data class MembershipSummary(
    val shopId: String,
    val role: ShopRole,
)

@Serializable
data class DeletionStatus(
    val requestedAt: Instant,
    val graceUntil: Instant,
    val blocked: Boolean,
)

@Serializable
data class MePatchBody(
    val displayName: String,
)

@Serializable
data class AccountDeletionBody(
    val code: String,
    val deleteOwnedShops: Boolean,
)

@Serializable
data class AccountDeletionReceipt(
    val requestedAt: Instant,
    val graceUntil: Instant,
    val shopsToDelete: List<String>,
)
