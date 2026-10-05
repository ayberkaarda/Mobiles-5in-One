package app.cetele.server.config

import app.cetele.server.security.CspNonceFilter
import app.cetele.server.security.JwtAuthenticationFilter
import app.cetele.server.security.JwtCodec
import app.cetele.server.security.RequestBodyLimitFilter
import app.cetele.server.security.SecurityHeadersConfig
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemWriter
import jakarta.servlet.DispatcherType
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.env.Environment
import org.springframework.http.HttpMethod
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.config.Customizer
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.access.intercept.AuthorizationFilter
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter
import org.springframework.security.web.header.HeaderWriterFilter
import java.util.EnumSet
import java.util.UUID

/**
 * The API security chain: stateless bearer JWT, deny by default.
 *
 * Public: `GET /actuator/health`, the three OTP/refresh endpoints and, in `local`/`test` only,
 * the OpenAPI document. Everything else needs a valid access token; per-shop permissions are
 * enforced with `@PreAuthorize` (method security). CORS is intentionally not configured: the API
 * has no browser clients, so no `Access-Control-*` header is ever written.
 */
@Configuration(proxyBeanMethods = false)
@EnableMethodSecurity
class SecurityConfig {
    @Bean
    fun apiSecurityFilterChain(
        http: HttpSecurity,
        jwtCodec: JwtCodec,
        jdbc: JdbcTemplate,
        problems: ProblemWriter,
        transport: TransportSecurityProperties,
        environment: Environment,
    ): SecurityFilterChain {
        val apiDocsPublic = LocalOnlyAdapterGuard.isAllowed(environment)
        http.authorizeHttpRequests { auth ->
            // Error dispatches render a registry problem body for a request that was already handled.
            auth.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
            auth.requestMatchers(HttpMethod.GET, "/actuator/health").permitAll()
            auth.requestMatchers(HttpMethod.POST, *PUBLIC_AUTH_PATHS.toTypedArray()).permitAll()
            if (apiDocsPublic) auth.requestMatchers(HttpMethod.GET, "/v3/api-docs", "/v3/api-docs/**").permitAll()
            auth.anyRequest().authenticated()
        }
        if (LocalOnlyAdapterGuard.requireHttps(transport.requireHttps, environment.activeProfiles.toList())) {
            http.redirectToHttps(Customizer.withDefaults())
        }
        http.sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        http.exceptionHandling { handling ->
            handling.authenticationEntryPoint { request, response, _ ->
                problems.write(request, response, ProblemCode.AUTH_UNAUTHENTICATED)
            }
            handling.accessDeniedHandler { request, response, _ ->
                problems.write(request, response, ProblemCode.FORBIDDEN)
            }
        }
        SecurityHeadersConfig.apply(http)
        http.addFilterBefore(CspNonceFilter(), HeaderWriterFilter::class.java)
        http.addFilterBefore(
            JwtAuthenticationFilter(jwtCodec, { userId -> isActiveUser(jdbc, userId) }, problems),
            AnonymousAuthenticationFilter::class.java,
        )
        // After authorization: anonymous callers get 401 before their body is looked at.
        http.addFilterAfter(RequestBodyLimitFilter(problems), AuthorizationFilter::class.java)
        // Bearer-token API without cookies; the admin console (Phase 5) gets its own chain with CSRF.
        http.csrf { it.disable() }
        http.httpBasic { it.disable() }
        http.formLogin { it.disable() }
        http.logout { it.disable() }
        http.requestCache { it.disable() }
        return http.build()
    }

    /** First servlet filter: every log line and every response of a request carries its trace id. */
    @Bean
    fun traceIdFilterRegistration(): FilterRegistrationBean<TraceIdFilter> =
        FilterRegistrationBean(TraceIdFilter()).apply {
            order = Ordered.HIGHEST_PRECEDENCE
            setDispatcherTypes(EnumSet.of(DispatcherType.REQUEST, DispatcherType.ERROR, DispatcherType.ASYNC))
        }

    private fun isActiveUser(
        jdbc: JdbcTemplate,
        userId: UUID,
    ): Boolean =
        jdbc
            .queryForList("SELECT deactivated_at IS NULL FROM users WHERE id = ?", Boolean::class.java, userId)
            .firstOrNull() == true

    companion object {
        val PUBLIC_AUTH_PATHS = listOf("/v1/auth/otp/request", "/v1/auth/otp/verify", "/v1/auth/refresh")
    }
}
