package app.cetele.android.feature.settings.common

import app.cetele.android.core.network.ApiResult

data class SettingsError(
    val code: String? = null,
    val traceId: String? = null,
    val retryAfterSeconds: Int? = null,
)

internal fun ApiResult<*>.error(): SettingsError? =
    when (this) {
        is ApiResult.Success -> null
        is ApiResult.Failure.Problem -> SettingsError(problem.code, problem.traceId, retryAfterSeconds)
        is ApiResult.Failure -> SettingsError()
    }
