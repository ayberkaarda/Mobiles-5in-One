package app.cetele.android.core.network

import app.cetele.android.core.network.integrity.FakeIntegrityTokenProvider
import app.cetele.android.core.network.integrity.IntegrityResult
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class FakeIntegrityTokenProviderTest {
    @Test
    fun `provider forwards every configured grammar value unchanged`() =
        runTest {
            for (suffix in listOf("ok", "unrecognized-app", "no-device-integrity", "package-mismatch", "invalid")) {
                val token = "fake." + suffix
                assertEquals(IntegrityResult.Token(token), FakeIntegrityTokenProvider(token).token("nonce"))
            }
        }
}
