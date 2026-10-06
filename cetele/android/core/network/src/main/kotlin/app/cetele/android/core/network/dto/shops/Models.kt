@file:UseSerializers(InstantSerializer::class, LocalDateSerializer::class)

package app.cetele.android.core.network.dto.shops

import app.cetele.android.core.network.dto.InstantSerializer
import app.cetele.android.core.network.dto.LocalDateSerializer
import app.cetele.android.core.network.dto.ShopPlan
import app.cetele.android.core.network.dto.ShopRole
import app.cetele.android.core.network.dto.ShopType
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import java.time.Instant

@Serializable
data class CreateShopRequest(
    val name: String,
    val type: ShopType,
    val il: String,
    val ilce: String,
)

@Serializable
data class UpdateShopRequest(
    val name: String? = null,
    val type: ShopType? = null,
    val il: String? = null,
    val ilce: String? = null,
)

@Serializable
data class ShopView(
    val id: String,
    val name: String,
    val type: ShopType,
    val il: String,
    val ilce: String,
    val plan: ShopPlan,
    val role: ShopRole,
    val createdAt: Instant,
)

@Serializable
data class CreateInvitationRequest(
    val phone: String,
)

@Serializable
data class IssuedInvitation(
    val id: String,
    val phone: String,
    val code: String,
    val expiresAt: Instant,
)

@Serializable
data class AcceptedInvitation(
    val shopId: String,
    val role: ShopRole,
)

@Serializable
data class MemberList(
    val members: List<MemberView>,
)

@Serializable
data class MemberView(
    val userId: String,
    val phone: String,
    val displayName: String? = null,
    val role: ShopRole,
    val joinedAt: Instant,
)

@Serializable
data class ReauthCode(
    val code: String,
)

@Serializable
data class DeletionReceipt(
    val requestedAt: Instant,
    val graceUntil: Instant,
)

@Serializable
data class OwnershipBody(
    val userId: String,
    val code: String,
)

@Serializable
data class OwnershipReceipt(
    val shopId: String,
    val ownerUserId: String,
    val previousOwnerUserId: String,
)
