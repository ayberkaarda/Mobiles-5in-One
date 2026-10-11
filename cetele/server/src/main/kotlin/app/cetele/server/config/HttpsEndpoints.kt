package app.cetele.server.config

import java.net.URI

object HttpsEndpoints {
    fun require(
        name: String,
        url: String,
    ) {
        val uri = runCatching { URI(url) }.getOrNull()
        require(uri != null && uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null) {
            "$name must be an https URI with a host and no user info"
        }
    }
}
