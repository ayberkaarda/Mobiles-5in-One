package app.cetele.server.web.site

import org.springframework.boot.context.properties.ConfigurationProperties
import java.net.URI

/**
 * `cetele.site.*` (ADR-0039).
 *
 * - `base-url` (`CETELE_SITE_BASE_URL`, default `https://cetele.app`): origin of every canonical,
 *   `hreflang`, Open Graph, sitemap and `llms.txt` URL. No trailing slash.
 * - `content-location` (`CETELE_SITE_CONTENT_LOCATION`, default `classpath:content/`): folder with
 *   the `pages`, `trades`, `guides` and `legal` Markdown files. Every route of [SiteRoutes] must
 *   find its file there or the application does not start.
 * - `android-cert-fingerprints` (`CETELE_ANDROID_CERT_SHA256`, default empty): comma separated
 *   SHA-256 fingerprints of the app signing certificate (`AA:BB:...`, 32 pairs). Empty means
 *   `/.well-known/assetlinks.json` answers 404; a fingerprint is never invented.
 * - `requests-per-minute` (default 120): token bucket per client address for the public routes.
 */
@ConfigurationProperties(prefix = "cetele.site")
data class SiteProperties(
    val baseUrl: String = DEFAULT_BASE_URL,
    val contentLocation: String = DEFAULT_CONTENT_LOCATION,
    val androidCertFingerprints: List<String> = emptyList(),
    val requestsPerMinute: Long = DEFAULT_REQUESTS_PER_MINUTE,
) {
    init {
        require(!baseUrl.endsWith('/')) { "cetele.site.base-url must have no trailing slash" }
        val uri = URI.create(baseUrl)
        require(uri.scheme in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.rawPath.orEmpty().isEmpty()) {
            "cetele.site.base-url must be an origin such as https://cetele.app"
        }
        require(contentLocation.endsWith('/')) { "cetele.site.content-location must end with a slash" }
        require(requestsPerMinute > 0) { "cetele.site.requests-per-minute must be positive" }
        fingerprints.forEach { fingerprint ->
            require(FINGERPRINT.matches(fingerprint)) {
                "cetele.site.android-cert-fingerprints must be SHA-256 fingerprints as 32 upper-case hex pairs joined by colons"
            }
        }
    }

    /** The configured fingerprints without blank entries (an empty environment value binds as one blank item). */
    val fingerprints: List<String>
        get() = androidCertFingerprints.map { it.trim() }.filter { it.isNotEmpty() }

    companion object {
        const val DEFAULT_BASE_URL = "https://cetele.app"
        const val DEFAULT_CONTENT_LOCATION = "classpath:content/"
        const val DEFAULT_REQUESTS_PER_MINUTE = 120L
        val FINGERPRINT = Regex("^([0-9A-F]{2}:){31}[0-9A-F]{2}$")
    }
}
