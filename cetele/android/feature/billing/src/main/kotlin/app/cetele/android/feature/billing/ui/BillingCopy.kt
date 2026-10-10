package app.cetele.android.feature.billing.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.core.domain.format.DateFormats
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.core.network.dto.problem.ProblemCodes
import app.cetele.android.feature.billing.BillingProblemCodes
import app.cetele.android.feature.billing.R
import app.cetele.android.feature.billing.data.SubscriptionStatus
import app.cetele.android.feature.billing.data.Usage
import java.time.Instant

@Composable
@ReadOnlyComposable
internal fun noticeText(notice: BillingNotice): String =
    when (notice) {
        BillingNotice.Linked -> {
            stringResource(R.string.billing_notice_linked)
        }

        BillingNotice.Queued -> {
            stringResource(R.string.billing_notice_queued)
        }

        BillingNotice.StoreUnavailable -> {
            stringResource(R.string.billing_notice_store_unavailable)
        }

        BillingNotice.StoreError -> {
            stringResource(R.string.billing_notice_store_error)
        }

        BillingNotice.NothingToRestore -> {
            stringResource(R.string.billing_notice_nothing_to_restore)
        }

        is BillingNotice.Problem -> {
            val text = billingCodeText(notice.code)?.let { stringResource(it) }
            val base = text ?: stringResource(ProblemCodeText.resIdOrGeneric(notice.code))
            val retry = notice.retryAfterSeconds?.let { pluralStringResource(R.plurals.billing_retry_after, it, it) }
            if (retry == null) base else "$base $retry"
        }
    }

/** Billing copy of the contract; `forbidden` on this screen means only the owner manages the subscription. */
@StringRes
internal fun billingCodeText(code: String?): Int? =
    when (code) {
        BillingProblemCodes.PURCHASE_INVALID -> R.string.billing_error_purchase_invalid
        BillingProblemCodes.TOKEN_IN_USE -> R.string.billing_error_token_in_use
        BillingProblemCodes.ALREADY_SUBSCRIBED -> R.string.billing_error_already_subscribed
        BillingProblemCodes.UNAVAILABLE -> R.string.billing_error_unavailable
        ProblemCodes.FORBIDDEN -> R.string.billing_error_forbidden
        else -> null
    }

@StringRes
internal fun statusText(status: SubscriptionStatus): Int =
    when (status) {
        SubscriptionStatus.PENDING -> R.string.billing_status_pending
        SubscriptionStatus.ACTIVE -> R.string.billing_status_active
        SubscriptionStatus.GRACE -> R.string.billing_status_grace
        SubscriptionStatus.ON_HOLD -> R.string.billing_status_on_hold
        SubscriptionStatus.PAUSED -> R.string.billing_status_paused
        SubscriptionStatus.CANCELED -> R.string.billing_status_canceled
        SubscriptionStatus.EXPIRED -> R.string.billing_status_expired
        SubscriptionStatus.REVOKED -> R.string.billing_status_revoked
        SubscriptionStatus.ENDED -> R.string.billing_status_ended
    }

@Composable
@ReadOnlyComposable
internal fun customersText(usage: Usage): String =
    if (usage.unlimited) {
        stringResource(R.string.billing_usage_customers_unlimited, usage.used)
    } else {
        stringResource(R.string.billing_usage_customers, usage.used, usage.limit ?: 0)
    }

@Composable
@ReadOnlyComposable
internal fun usageText(
    @StringRes text: Int,
    usage: Usage,
): String = stringResource(text, usage.used, usage.limit ?: 0)

internal fun longDate(instant: Instant): String = DateFormats.long(instant.atZone(CeteleClock.ZONE).toLocalDate())
