package app.cetele.android.core.domain.validation

object PhoneValidator {
    private val mobile = Regex("^\\+905[0-9]{9}$")

    fun isValid(phone: String): Boolean = mobile.matches(phone)

    fun validate(phone: String): List<FieldError> =
        when {
            phone.isBlank() -> listOf(FieldError("phone", FieldCodes.REQUIRED))
            !isValid(phone) -> listOf(FieldError("phone", FieldCodes.INVALID_FORMAT))
            else -> emptyList()
        }
}
