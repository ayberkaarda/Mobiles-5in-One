package app.cetele.server.reminders.delivery

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
 * Own chain for the delivery-report webhook (ADR-0032): no bearer filter, no session, no CSRF
 * token (the HMAC is the credential). The API chain stays last and answers every other path.
 */
@Configuration(proxyBeanMethods = false)
class SmsDlrSecurityConfig {
    @Bean
    @Order(CHAIN_ORDER)
    fun smsDlrSecurityFilterChain(
        http: HttpSecurity,
        transport: TransportSecurityProperties,
        environment: Environment,
    ): SecurityFilterChain {
        http.securityMatcher(PATH)
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
        const val PATH = "/v1/webhooks/sms-dlr"
        const val CHAIN_ORDER = 21
    }
}
