@file:UseSerializers(InstantSerializer::class, LocalDateSerializer::class)

package app.cetele.android.core.network.dto.reminders

import app.cetele.android.core.network.dto.InstantSerializer
import app.cetele.android.core.network.dto.LocalDateSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import java.time.Instant

@Serializable
data class ReminderRequest(
    val customerId: String,
    val channel: String = "SMS",
    val template: String = "BALANCE",
)

@Serializable
data class ReminderResponse(
    val reminderId: String,
    val status: String,
    val sentAt: Instant,
    val providerMessageId: String? = null,
    val quota: QuotaState,
)

@Serializable
data class QuotaState(
    val month: String,
    val used: Int,
    val limit: Int,
)
