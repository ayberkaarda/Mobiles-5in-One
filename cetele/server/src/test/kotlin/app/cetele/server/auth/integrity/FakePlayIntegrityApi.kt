package app.cetele.server.auth.integrity

/**
 * Test adapter of [PlayIntegrityApi]: answers a registered result per token and counts calls; an
 * unregistered token is `Invalid`, as Google answers a token it did not issue.
 */
class FakePlayIntegrityApi : PlayIntegrityApi {
    private val results = mutableMapOf<String, IntegrityDecodeResult>()
    var calls = 0
        private set

    fun put(
        token: String,
        result: IntegrityDecodeResult,
    ) {
        results[token] = result
    }

    override fun decodeIntegrityToken(token: String): IntegrityDecodeResult {
        calls++
        return results[token] ?: IntegrityDecodeResult.Invalid
    }
}
