package app.cetele.server.web.site

import app.cetele.server.config.LocalOnlyAdapterGuard
import app.cetele.server.config.TransportSecurityProperties
import app.cetele.server.security.SecurityHeadersConfig
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.core.env.Environment
import org.springframework.security.config.Customizer
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.context.RequestAttributeSecurityContextRepository
import org.springframework.security.web.header.HeaderWriterFilter
import org.springframework.security.web.header.writers.DelegatingRequestMatcherHeaderWriter
import org.springframework.security.web.header.writers.StaticHeadersWriter
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher
import org.springframework.web.filter.ShallowEtagHeaderFilter

/**
 * The public site chain (ADR-0034): the registry pages, the slug families, the machine-readable
 * files and the site assets, ordered before the stateless API chain. It reads no credential,
 * creates no session and sets no cookie; only GET and HEAD reach a handler. The shared header
 * baseline of ADR-0010 applies; the CSP is a fixed policy without a nonce because the pages carry
 * no inline script or style, which also keeps a page byte-identical between requests for its ETag.
 * The statement page, the console and the API are not matched here and keep their own chains.
 */
@Configuration(proxyBeanMethods = false)
class SiteSecurityConfig {
    @Bean
    @Order(CHAIN_ORDER)
    fun siteSecurityFilterChain(
        http: HttpSecurity,
        properties: SiteProperties,
        transport: TransportSecurityProperties,
        environment: Environment,
    ): SecurityFilterChain {
        http.securityMatcher(*SiteRoutes.chainPatterns.toTypedArray())
        http.authorizeHttpRequests { it.anyRequest().permitAll() }
        if (LocalOnlyAdapterGuard.requireHttps(transport.requireHttps, environment.activeProfiles.toList())) {
            http.redirectToHttps(Customizer.withDefaults())
        }
        http.sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        http.securityContext { it.securityContextRepository(RequestAttributeSecurityContextRepository()) }
        SecurityHeadersConfig.apply(http)
        http.headers { headers ->
            headers.contentSecurityPolicy { it.policyDirectives(CSP) }
            headers.addHeaderWriter(
                DelegatingRequestMatcherHeaderWriter(
                    PathPatternRequestMatcher.withDefaults().matcher(SiteRoutes.ASSETS),
                    StaticHeadersWriter("Cache-Control", ASSET_CACHE),
                ),
            )
        }
        http.addFilterAfter(SiteRequestFilter(properties.requestsPerMinute), HeaderWriterFilter::class.java)
        http.addFilterAfter(ShallowEtagHeaderFilter(), SiteRequestFilter::class.java)
        http.csrf { it.disable() }
        http.httpBasic { it.disable() }
        http.formLogin { it.disable() }
        http.logout { it.disable() }
        http.requestCache { it.disable() }
        return http.build()
    }

    companion object {
        const val CHAIN_ORDER = 30

        const val CSP =
            "default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
                "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

        /** Fonts, the stylesheet and the images: one week, revalidated by ETag and Last-Modified afterwards. */
        const val ASSET_CACHE = "public, max-age=604800"
    }
}
