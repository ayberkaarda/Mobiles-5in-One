package app.cetele.android.feature.auth.common

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.core.network.ApiResult
import app.cetele.android.feature.auth.R

data class AuthError(
    val resource: Int? = null,
    val code: String? = null,
    val traceId: String? = null,
)

fun ApiResult.Failure.retryDelaySeconds(): Int? =
    when (this) {
        is ApiResult.Failure.Problem -> {
            val limited = problem.status == RATE_LIMITED
            if (limited) retryAfterSeconds?.coerceAtLeast(1) ?: DEFAULT_RETRY_SECONDS else null
        }

        is ApiResult.Failure.Unexpected -> {
            if (status == RATE_LIMITED) DEFAULT_RETRY_SECONDS else null
        }

        is ApiResult.Failure.Network -> {
            null
        }
    }

private const val RATE_LIMITED = 429
private const val DEFAULT_RETRY_SECONDS = 60

fun ApiResult.Failure.authError(): AuthError =
    when (this) {
        is ApiResult.Failure.Problem -> AuthError(code = problem.code, traceId = problem.traceId)
        else -> AuthError(resource = R.string.auth_common_connection_error)
    }

@Composable
fun AuthErrorText(
    error: AuthError?,
    modifier: Modifier = Modifier,
) {
    if (error != null) {
        Column(modifier = modifier) {
            Text(
                stringResource(error.resource ?: ProblemCodeText.resIdOrGeneric(error.code)),
                color = MaterialTheme.colorScheme.error,
            )
            if (error.traceId != null && error.resource == null && ProblemCodeText.resId(error.code) == null) {
                Text(
                    stringResource(R.string.auth_common_support_code, error.traceId),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
