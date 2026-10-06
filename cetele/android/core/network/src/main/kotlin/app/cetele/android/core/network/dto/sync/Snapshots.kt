@file:UseSerializers(InstantSerializer::class, LocalDateSerializer::class)

package app.cetele.android.core.network.dto.sync

import app.cetele.android.core.network.dto.ConsentSource
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.InstantSerializer
import app.cetele.android.core.network.dto.LocalDateSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import java.time.Instant
import java.time.LocalDate

@Serializable
data class CustomerSnapshot(
    val id: String,
    val name: String,
    val phone: String? = null,
    val note: String? = null,
    val tag: String? = null,
    val smsConsent: Boolean,
    val smsConsentAt: Instant? = null,
    val smsConsentSource: ConsentSource? = null,
    val createdAt: Instant,
    val updatedAt: Instant,
    val deletedAt: Instant? = null,
)

@Serializable
data class EntrySnapshot(
    val id: String,
    val customerId: String,
    val type: EntryType,
    val amountMinor: Long,
    val currency: String,
    val occurredOn: LocalDate,
    val dueOn: LocalDate? = null,
    val note: String? = null,
    val photoKey: String? = null,
    val reverses: String? = null,
    val reversedBy: String? = null,
    val createdBy: String? = null,
    val createdAt: Instant,
)
