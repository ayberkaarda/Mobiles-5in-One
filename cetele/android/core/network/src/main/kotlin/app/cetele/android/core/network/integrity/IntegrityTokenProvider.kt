package app.cetele.android.core.network.integrity

interface IntegrityTokenProvider {
    suspend fun token(nonce: String): IntegrityResult
}

sealed interface IntegrityResult {
    data class Token(
        val value: String,
    ) : IntegrityResult

    data class Unavailable(
        val reason: String,
    ) : IntegrityResult
}

class FakeIntegrityTokenProvider(
    private val token: String,
) : IntegrityTokenProvider {
    override suspend fun token(nonce: String): IntegrityResult = IntegrityResult.Token(token)
}
