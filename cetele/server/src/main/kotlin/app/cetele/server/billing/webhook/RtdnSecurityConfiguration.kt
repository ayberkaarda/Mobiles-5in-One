package app.cetele.server.billing.webhook

import app.cetele.server.config.LocalOnlyAdapterGuard
import app.cetele.server.config.TransportSecurityProperties
import app.cetele.server.security.CspNonceFilter
import app.cetele.server.security.SecurityHeadersConfig
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.core.env.Environment
import org.springframework.security.config.Customizer
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.header.HeaderWriterFilter

/**
 * The RTDN webhook's own chain (ADR-0032), ahead of the API chain: only its exact path, stateless,
 * no access-token filter, no CSRF, form login, HTTP Basic, logout or request cache. The controller
 * authenticates the push itself on the raw body; the security headers and the HTTPS rule stay.
 */
@Configuration(proxyBeanMethods = false)
class RtdnSecurityConfiguration {
    @Bean
    @Order(ORDER)
    fun rtdnSecurityFilterChain(
        http: HttpSecurity,
        transport: TransportSecurityProperties,
        environment: Environment,
    ): SecurityFilterChain {
        http.securityMatcher(RtdnExpectations.PATH)
        http.authorizeHttpRequests { it.anyRequest().permitAll() }
        if (LocalOnlyAdapterGuard.requireHttps(transport.requireHttps, environment.activeProfiles.toList())) {
            http.redirectToHttps(Customizer.withDefaults())
        }
        http.sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        SecurityHeadersConfig.apply(http)
        http.addFilterBefore(CspNonceFilter(), HeaderWriterFilter::class.java)
        http.csrf { it.disable() }
        http.httpBasic { it.disable() }
        http.formLogin { it.disable() }
        http.logout { it.disable() }
        http.requestCache { it.disable() }
        return http.build()
    }

    companion object {
        const val ORDER = 20
    }
}
