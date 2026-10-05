package app.cetele.android.core.network

import java.net.URI

/**
 * Base address of the Çetele API. HTTPS is required; plain HTTP is accepted only for the
 * emulator host loopback used by debug builds, which the debug network security config allows.
 */
class ApiConfig(
    baseUrl: String,
) {
    val baseUrl: String = if (baseUrl.endsWith('/')) baseUrl else "$baseUrl/"

    init {
        val uri = runCatching { URI(this.baseUrl) }.getOrNull()
        require(uri != null && uri.host != null) { "API base URL is not a valid absolute URL" }
        val scheme = uri.scheme?.lowercase()
        require(scheme == "https" || (scheme == "http" && uri.host in DEBUG_HTTP_HOSTS)) {
            "API base URL must use HTTPS"
        }
    }

    companion object {
        /** Hosts reachable over plain HTTP from a debug build only (Android emulator to the dev machine). */
        val DEBUG_HTTP_HOSTS: Set<String> = setOf("10.0.2.2")
    }
}
