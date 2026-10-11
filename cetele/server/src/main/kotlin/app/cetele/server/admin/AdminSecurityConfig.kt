package app.cetele.server.admin

import app.cetele.server.admin.web.AdminAccessDeniedHandler
import app.cetele.server.config.LocalOnlyAdapterGuard
import app.cetele.server.config.TransportSecurityProperties
import app.cetele.server.security.CspNonceFilter
import app.cetele.server.security.SecurityHeadersConfig
import jakarta.servlet.DispatcherType
import jakarta.servlet.SessionTrackingMode
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.web.servlet.ServletContextInitializer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.core.env.Environment
import org.springframework.http.HttpMethod
import org.springframework.security.config.Customizer
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.context.HttpSessionSecurityContextRepository
import org.springframework.security.web.context.SecurityContextHolderFilter
import org.springframework.security.web.header.HeaderWriterFilter
import org.springframework.security.web.header.writers.StaticHeadersWriter
import org.springframework.web.servlet.ViewResolver
import java.time.Clock
import org.springframework.security.web.header.Header as ResponseHeader

/**
 * The console chain (ADR-0033): the `/admin` paths only, ordered before the stateless API chain. Session
 * based with the console's own login controllers, Spring CSRF on every state change, the shared
 * header baseline plus `Cache-Control: no-store` and `X-Robots-Tag`. Anonymous requests are
 * redirected to `/admin/login`; a role without the action gets the 403 console page. A `/v1`
 * bearer token is never read here, and the API chain never reads this session.
 */
@Configuration(proxyBeanMethods = false)
class AdminSecurityConfig {
    @Bean
    fun adminSecurityContextRepository(): HttpSessionSecurityContextRepository = HttpSessionSecurityContextRepository()

    @Bean
    @Order(10)
    fun adminSecurityFilterChain(
        http: HttpSecurity,
        contextRepository: HttpSessionSecurityContextRepository,
        management: AdminManagementService,
        transport: TransportSecurityProperties,
        environment: Environment,
        clock: Clock,
        @Qualifier("thymeleafViewResolver") viewResolver: ViewResolver,
    ): SecurityFilterChain {
        http.securityMatcher("/admin/**")
        http.authorizeHttpRequests { auth ->
            auth.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
            auth.requestMatchers(*PUBLIC_PATHS.toTypedArray()).permitAll()
            auth.requestMatchers(HttpMethod.GET, *READ_PATHS.toTypedArray()).hasAnyRole(AdminRole.ADMIN.name, AdminRole.SUPPORT.name)
            auth.requestMatchers(HttpMethod.GET, *ADMIN_READ_PATHS.toTypedArray()).hasRole(AdminRole.ADMIN.name)
            auth.requestMatchers(HttpMethod.POST, *ADMIN_WRITE_PATHS.toTypedArray()).hasRole(AdminRole.ADMIN.name)
            auth.anyRequest().denyAll()
        }
        if (LocalOnlyAdapterGuard.requireHttps(transport.requireHttps, environment.activeProfiles.toList())) {
            http.redirectToHttps(Customizer.withDefaults())
        }
        http.securityContext { it.securityContextRepository(contextRepository) }
        http.sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED) }
        http.exceptionHandling { handling ->
            handling.authenticationEntryPoint { _, response, _ ->
                response.status = 302
                response.setHeader("Location", LOGIN_PATH)
            }
            handling.accessDeniedHandler(AdminAccessDeniedHandler(viewResolver))
        }
        SecurityHeadersConfig.apply(http)
        http.headers { headers ->
            headers.addHeaderWriter(
                StaticHeadersWriter(
                    listOf(
                        ResponseHeader("Cache-Control", "no-store"),
                        ResponseHeader("Pragma", "no-cache"),
                        ResponseHeader("X-Robots-Tag", "noindex, nofollow"),
                    ),
                ),
            )
        }
        http.addFilterBefore(CspNonceFilter(), HeaderWriterFilter::class.java)
        http.addFilterAfter(AdminSessionFilter(clock) { management.isCurrent(it) }, SecurityContextHolderFilter::class.java)
        http.csrf(Customizer.withDefaults())
        http.requestCache { it.disable() }
        http.httpBasic { it.disable() }
        http.formLogin { it.disable() }
        http.logout { it.disable() }
        http.anonymous(Customizer.withDefaults())
        return http.build()
    }

    /**
     * The servlet session cookie is only used by the console: `__Host-CETELE_ADMIN`, HttpOnly,
     * Secure (also locally), SameSite=Strict, Path=/, no Domain, cookie tracking only.
     */
    @Bean
    fun adminSessionCookie(): ServletContextInitializer =
        ServletContextInitializer { context ->
            context.sessionCookieConfig.apply {
                name = AdminSessionPolicy.COOKIE_NAME
                isHttpOnly = true
                isSecure = true
                path = "/"
                setAttribute("SameSite", "Strict")
            }
            context.setSessionTrackingModes(setOf(SessionTrackingMode.COOKIE))
            context.sessionTimeout = AdminSessionPolicy.IDLE.toMinutes().toInt()
        }

    companion object {
        const val LOGIN_PATH = "/admin/login"

        /** Login steps and logout; the controllers check the pre-authentication state themselves. */
        val PUBLIC_PATHS =
            listOf(LOGIN_PATH, "/admin/login/totp", "/admin/totp/enroll", "/admin/account/password", "/admin/logout")

        val READ_PATHS = listOf("/admin", "/admin/shops", "/admin/shops/*", "/admin/users", "/admin/users/*")

        val ADMIN_READ_PATHS = listOf("/admin/audit", "/admin/admins", "/admin/admins/new")

        val ADMIN_WRITE_PATHS =
            listOf(
                "/admin/users/*/deactivate",
                "/admin/users/*/reactivate",
                "/admin/users/*/devices/*/revoke",
                "/admin/admins/new",
                "/admin/admins/*/role",
                "/admin/admins/*/disable",
                "/admin/admins/*/enable",
                "/admin/admins/*/totp-reset",
            )
    }
}
