package app.cetele.android.feature.shop

import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.domain.validation.Limits
import app.cetele.android.core.network.dto.ShopType
import app.cetele.android.core.network.dto.shops.CreateShopRequest

data class ShopForm(
    val name: String = "",
    val type: ShopType? = null,
    val il: String = "",
    val ilce: String = "",
) {
    fun errors(): List<FieldError> =
        buildList {
            for ((field, value) in listOf("name" to name, "il" to il, "ilce" to ilce)) {
                when {
                    value.isBlank() -> add(FieldError(field, FieldCodes.REQUIRED))
                    value.length > Limits.NAME_MAX -> add(FieldError(field, FieldCodes.TOO_LONG))
                    value.any { it.isISOControl() } -> add(FieldError(field, FieldCodes.INVALID_FORMAT))
                }
            }
            if (type == null) add(FieldError("type", FieldCodes.REQUIRED))
        }

    fun request(): CreateShopRequest = CreateShopRequest(name.trim(), requireNotNull(type), il.trim(), ilce.trim())

    companion object {
        fun from(shop: Shop): ShopForm = ShopForm(shop.name, ShopType.valueOf(shop.type.name), shop.il, shop.ilce)
    }
}

data class ShopFormState(
    val form: ShopForm = ShopForm(),
    val errors: List<FieldError> = emptyList(),
    val busy: Boolean = false,
    val completedShopId: String? = null,
    val failure: ShopFailure? = null,
)
