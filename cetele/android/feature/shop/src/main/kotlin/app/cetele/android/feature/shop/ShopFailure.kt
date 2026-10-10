package app.cetele.android.feature.shop

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.network.ApiResult

data class ShopFailure(
    val code: String? = null,
    val traceId: String? = null,
    val retryAfterSeconds: Int? = null,
    val invalidInvitation: Boolean = false,
    val fields: List<FieldError> = emptyList(),
) {
    companion object {
        fun from(
            failure: ApiResult.Failure,
            joining: Boolean = false,
        ): ShopFailure {
            val problem = failure as? ApiResult.Failure.Problem
            return ShopFailure(
                code = problem?.problem?.code,
                traceId = problem?.problem?.traceId,
                retryAfterSeconds = problem?.retryAfterSeconds,
                invalidInvitation =
                    joining && (
                        problem?.problem?.status == 404 ||
                            (failure as? ApiResult.Failure.Unexpected)?.status == 404
                    ),
                fields =
                    problem
                        ?.problem
                        ?.errors
                        ?.map { FieldError(it.field, it.code) }
                        .orEmpty(),
            )
        }
    }
}

@Composable
internal fun ShopFailureText(failure: ShopFailure?) {
    if (failure != null) {
        val copy =
            when {
                failure.invalidInvitation -> {
                    stringResource(R.string.shop_join_invalid)
                }

                failure.retryAfterSeconds != null -> {
                    stringResource(
                        R.string.shop_common_retry,
                        failure.retryAfterSeconds,
                    )
                }

                else -> {
                    stringResource(ProblemCodeText.resIdOrGeneric(failure.code))
                }
            }
        Text(copy)
        if (ProblemCodeText.resId(failure.code) == null && failure.traceId != null) {
            Text(
                stringResource(R.string.shop_common_support, failure.traceId),
                style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
            )
        }
    }
}
