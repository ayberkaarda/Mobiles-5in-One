package app.cetele.server.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.bind.Name
import java.net.URI

@ConfigurationProperties(prefix = "cetele")
data class PublicUrlProperties(
    @param:Name("public-base-url") val baseUrl: String = "",
) {
    init {
        require(baseUrl.isNotBlank()) { "CETELE_PUBLIC_BASE_URL must be set" }
        require(!baseUrl.endsWith('/')) { "CETELE_PUBLIC_BASE_URL must have no trailing slash" }
        val uri = URI.create(baseUrl)
        require(uri.scheme in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.query == null && uri.fragment == null) {
            "CETELE_PUBLIC_BASE_URL must be an HTTP URL"
        }
    }
}
