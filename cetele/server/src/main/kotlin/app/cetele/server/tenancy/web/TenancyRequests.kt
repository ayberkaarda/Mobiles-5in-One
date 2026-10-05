package app.cetele.server.tenancy.web

import app.cetele.server.tenancy.shop.ShopType
import app.cetele.server.web.validation.E164Tr
import app.cetele.server.web.validation.FieldLimits
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size

/** Visible text: at least one non-space character, no control characters. */
internal const val TEXT_PATTERN = "^[^\\p{Cntrl}]*[^\\p{Cntrl}\\s][^\\p{Cntrl}]*$"

/** `POST /v1/shops`. Unknown properties (e.g. `plan`) are rejected with 422 `unknown_property`. */
data class CreateShopRequest(
    @field:Size(min = FieldLimits.NAME_MIN, max = FieldLimits.NAME_MAX)
    @field:Pattern(regexp = TEXT_PATTERN)
    val name: String,
    val type: ShopType,
    @field:Size(min = FieldLimits.NAME_MIN, max = FieldLimits.NAME_MAX)
    @field:Pattern(regexp = TEXT_PATTERN)
    val il: String,
    @field:Size(min = FieldLimits.NAME_MIN, max = FieldLimits.NAME_MAX)
    @field:Pattern(regexp = TEXT_PATTERN)
    val ilce: String,
)

/** `PATCH /v1/shops/{shopId}`: absent fields stay unchanged; `plan` is not a property here. */
data class UpdateShopRequest(
    @field:Size(min = FieldLimits.NAME_MIN, max = FieldLimits.NAME_MAX)
    @field:Pattern(regexp = TEXT_PATTERN)
    val name: String? = null,
    val type: ShopType? = null,
    @field:Size(min = FieldLimits.NAME_MIN, max = FieldLimits.NAME_MAX)
    @field:Pattern(regexp = TEXT_PATTERN)
    val il: String? = null,
    @field:Size(min = FieldLimits.NAME_MIN, max = FieldLimits.NAME_MAX)
    @field:Pattern(regexp = TEXT_PATTERN)
    val ilce: String? = null,
)

/** `POST /v1/shops/{shopId}/invitations`: a Turkish mobile number in E.164 form. */
data class CreateInvitationRequest(
    @field:E164Tr
    val phone: String,
)
