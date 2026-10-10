@file:UseSerializers(InstantSerializer::class, LocalDateSerializer::class)

package app.cetele.android.core.network.dto.statements

import app.cetele.android.core.network.dto.InstantSerializer
import app.cetele.android.core.network.dto.LocalDateSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import java.time.Instant

@Serializable
data class StatementLinkRequest(
    val customerId: String,
)

@Serializable
data class StatementLinkResponse(
    val linkId: String,
    val url: String,
    val token: String,
    val expiresAt: Instant,
)
