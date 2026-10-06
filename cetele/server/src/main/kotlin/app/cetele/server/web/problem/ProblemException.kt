package app.cetele.server.web.problem

/**
 * Thrown by services and filters to end a request with a registry error.
 *
 * [detail] is for the server log only (it is masked there) and never reaches the response body.
 * [headers] are added to the response, e.g. `Retry-After` for [ProblemCode.RATE_LIMITED].
 */
class ProblemException(
    val code: ProblemCode,
    val detail: String? = null,
    val errors: List<ProblemFieldError> = emptyList(),
    val headers: Map<String, String> = emptyMap(),
) : RuntimeException(code.code + (detail?.let { ": $it" } ?: "")) {
    // Problems are expected control flow; a stack trace adds cost and nothing for the client.
    override fun fillInStackTrace(): Throwable = this
}

/** One invalid input field: the JSON property path and a machine code from [FieldErrorCodes]. */
data class ProblemFieldError(
    val field: String,
    val code: String,
)

/** Field error codes returned in `errors[].code`. Clients translate them; values never echo input. */
object FieldErrorCodes {
    const val REQUIRED = "required"
    const val INVALID_FORMAT = "invalid_format"
    const val TOO_LONG = "too_long"
    const val OUT_OF_RANGE = "out_of_range"
    const val OUT_OF_ORDER = "out_of_order"

    /** A JSON property the endpoint does not accept (unknown properties are rejected). */
    const val UNKNOWN_PROPERTY = "unknown_property"
}
