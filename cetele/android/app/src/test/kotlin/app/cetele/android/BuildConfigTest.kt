package app.cetele.android

import app.cetele.android.core.network.ApiConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class BuildConfigTest {
    @Test
    fun `application identity matches the store listing`() {
        assertEquals("app.cetele.android", BuildConfig.APPLICATION_ID)
        assertEquals("0.3.0", BuildConfig.VERSION_NAME)
    }

    @Test
    fun `configured API base URL is accepted by the network layer`() {
        val config = ApiConfig(BuildConfig.API_BASE_URL)

        assertTrue(config.baseUrl.endsWith("/"))
    }
}
