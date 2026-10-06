package app.cetele.android.core.network

sealed interface ApiResult<out T> {
    data class Success<T>(
        val value: T,
        val status: Int,
    ) : ApiResult<T>

    sealed interface Failure : ApiResult<Nothing> {
        data class Problem(
            val problem: ProblemDetail,
            val retryAfterSeconds: Int? = null,
        ) : Failure

        data class Network(
            val cause: Throwable,
        ) : Failure

        data class Unexpected(
            val status: Int,
        ) : Failure
    }

    fun getOrNull(): T? =
        when (this) {
            is Success -> value
            is Failure -> null
        }

    val problemCode: String?
        get() = (this as? Failure.Problem)?.problem?.code

    fun <R> map(transform: (T) -> R): ApiResult<R> =
        when (this) {
            is Success -> Success(transform(value), status)
            is Failure -> this
        }
}
