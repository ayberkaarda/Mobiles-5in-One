package app.cetele.server.config

import jakarta.servlet.http.HttpServletRequest
import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * Proxies whose `X-Forwarded-For` / `X-Forwarded-Proto` headers are honoured, from
 * `CETELE_TRUSTED_PROXIES` (a regular expression or comma separated CIDR list; empty = trust
 * nobody). The same value is handed to Tomcat's RemoteIpValve as both its internal and trusted
 * proxy list (`server.tomcat.remoteip.*` in `application.yml`), which rewrites `remoteAddr` and
 * `isSecure()` only for requests that arrive from such a proxy.
 */
@ConfigurationProperties(prefix = "cetele.client-ip")
data class ClientIpProperties(
    val trustedProxies: String = "",
)

/** The client address used for rate-limit keys and logs. */
object ClientIp {
    /**
     * Reads `remoteAddr` only. Forwarded headers are applied by the RemoteIpValve before this
     * point and only for trusted proxies, so a spoofed `X-Forwarded-For` from any other peer has
     * no effect here.
     */
    fun of(request: HttpServletRequest): String = request.remoteAddr
}
