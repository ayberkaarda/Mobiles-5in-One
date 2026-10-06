@file:UseSerializers(InstantSerializer::class, LocalDateSerializer::class)

package app.cetele.android.core.network.dto.auth

import app.cetele.android.core.network.dto.InstantSerializer
import app.cetele.android.core.network.dto.LocalDateSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers

@Serializable
data class OtpRequestBody(
    val phone: String,
    val deviceId: String,
    val integrityToken: String? = null,
)

@Serializable
data class OtpVerifyBody(
    val phone: String,
    val deviceId: String,
    val code: String,
    val model: String,
    val appVersion: String,
)

@Serializable
data class SignInResponse(
    val accessToken: String,
    val expiresIn: Long,
    val refreshToken: String,
    val user: UserSummary,
    val isNewUser: Boolean,
)

@Serializable
data class UserSummary(
    val id: String,
    val displayName: String? = null,
)

@Serializable
data class RefreshBody(
    val refreshToken: String,
)

@Serializable
data class TokenResponse(
    val accessToken: String,
    val expiresIn: Long,
    val refreshToken: String,
)
