package app.cetele.server.config

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * `cetele.security.require-https`: when true, every plain-HTTP request is redirected to HTTPS by
 * the security chain. `true` by default; `application.yml` turns it off for `local` and `test`.
 * Behind the TLS proxy, `isSecure()` comes from `X-Forwarded-Proto` of a trusted proxy.
 */
@ConfigurationProperties(prefix = "cetele.security")
data class TransportSecurityProperties(
    val requireHttps: Boolean = true,
)
