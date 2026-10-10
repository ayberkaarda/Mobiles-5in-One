package app.cetele.android.feature.reminders.sheet

import app.cetele.android.core.data.database.entity.ReminderLogEntity
import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.network.dto.reminders.QuotaState
import app.cetele.android.feature.reminders.R

data class ReminderState(
    val shop: Shop? = null,
    val customer: Customer? = null,
    val balanceMinor: Long = 0,
    val lastReminder: ReminderLogEntity? = null,
    val quota: QuotaState? = null,
    val busy: Boolean = false,
    val message: Int? = null,
    val traceId: String? = null,
    val retryAtMillis: Long = 0,
    val retrySeconds: Int? = null,
    val smsUncertain: Boolean = false,
) {
    val whatsappDisabledReason: Int?
        get() =
            when {
                shop == null || customer == null || customer.deletedAt != null -> R.string.reminders_sheet_unavailable
                customer.phone.isNullOrBlank() -> R.string.reminders_sheet_phone_missing
                balanceMinor <= 0 -> R.string.reminders_sheet_no_balance
                else -> null
            }

    val smsDisabledReason: Int?
        get() =
            whatsappDisabledReason ?: when {
                customer?.smsConsent != true -> R.string.reminders_sheet_consent_missing
                smsUncertain -> R.string.reminders_sheet_provider_failed
                else -> null
            }
}
