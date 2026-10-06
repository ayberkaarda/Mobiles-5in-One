package app.cetele.server.security

import org.springframework.security.config.Customizer
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.web.header.writers.DelegatingRequestMatcherHeaderWriter
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy
import org.springframework.security.web.header.writers.StaticHeadersWriter
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher
import org.springframework.security.web.header.Header as ResponseHeader

/**
 * Response headers written on every response of the security chain (401/403 included).
 * The Content-Security-Policy comes from [CspNonceFilter] because it carries a per-request nonce.
 */
object SecurityHeadersConfig {
    const val HSTS = "max-age=63072000; includeSubDomains; preload"
    const val PERMISSIONS_POLICY = "camera=(), geolocation=(), microphone=()"

    fun apply(http: HttpSecurity) {
        http.headers { headers ->
            // Written only on secure requests, as the HSTS specification requires. A static writer
            // keeps the exact documented value (Spring's own writer spaces the separators).
            headers.httpStrictTransportSecurity { it.disable() }
            headers.addHeaderWriter(
                DelegatingRequestMatcherHeaderWriter(
                    { request -> request.isSecure },
                    StaticHeadersWriter("Strict-Transport-Security", HSTS),
                ),
            )
            headers.contentTypeOptions(Customizer.withDefaults())
            headers.referrerPolicy { it.policy(ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN) }
            headers.frameOptions { it.deny() }
            headers.addHeaderWriter(StaticHeadersWriter("Permissions-Policy", PERMISSIONS_POLICY))
            // API responses are never cached; pages (Phase 5) set their own caching.
            headers.cacheControl { it.disable() }
            headers.addHeaderWriter(
                DelegatingRequestMatcherHeaderWriter(
                    PathPatternRequestMatcher.withDefaults().matcher("/v1/**"),
                    StaticHeadersWriter(listOf(ResponseHeader("Cache-Control", "no-store"), ResponseHeader("Pragma", "no-cache"))),
                ),
            )
        }
    }
}
