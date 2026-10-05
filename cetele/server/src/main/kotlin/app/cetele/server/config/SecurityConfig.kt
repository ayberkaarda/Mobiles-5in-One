package app.cetele.server.security

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.invoke
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.HttpStatusEntryPoint

/**
 * Deny-by-default baseline: only the public health endpoint is reachable. Authentication
 * (OTP + JWT) and per-shop authorization arrive with the auth module; until then every
 * other request is answered with 401 (no credentials) and never reaches a handler.
 */
@Configuration(proxyBeanMethods = false)
class SecurityConfig {
    @Bean
    fun apiSecurityFilterChain(http: HttpSecurity): SecurityFilterChain {
        http {
            authorizeHttpRequests {
                authorize(HttpMethod.GET, "/actuator/health", permitAll)
                authorize(anyRequest, denyAll)
            }
            sessionManagement {
                sessionCreationPolicy = SessionCreationPolicy.STATELESS
            }
            exceptionHandling {
                authenticationEntryPoint = HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)
            }
            // Bearer-token API without cookies; the admin console gets its own chain with CSRF.
            csrf { disable() }
            httpBasic { disable() }
            formLogin { disable() }
            logout { disable() }
        }
        return http.build()
    }
}
