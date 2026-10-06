package app.cetele.android.core.domain.model

import java.time.Instant

data class Shop(
    val id: String,
    val name: String,
    val type: ShopType,
    val il: String,
    val ilce: String,
    val plan: ShopPlan,
    val role: ShopRole,
    val createdAt: Instant,
)
