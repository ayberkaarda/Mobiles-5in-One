package app.cetele.android.core.domain.model

import java.time.Instant

data class Customer(
    val id: String,
    val shopId: String,
    val name: String,
    val phone: String?,
    val note: String?,
    val tag: String?,
    val smsConsent: Boolean,
    val smsConsentAt: Instant?,
    val smsConsentSource: ConsentSource?,
    val createdAt: Instant,
    val updatedAt: Instant,
    val deletedAt: Instant?,
)
