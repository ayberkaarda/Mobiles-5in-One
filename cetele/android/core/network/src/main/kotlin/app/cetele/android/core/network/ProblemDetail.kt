package app.cetele.android.core.network

import kotlinx.serialization.Serializable

/**
 * RFC 9457 error body returned by the API. `code` is a stable machine code that the app maps to
 * Turkish copy; the server never includes exception messages.
 */
@Serializable
data class ProblemDetail(
    val type: String? = null,
    val title: String,
    val status: Int,
    val code: String? = null,
    val traceId: String? = null,
)
