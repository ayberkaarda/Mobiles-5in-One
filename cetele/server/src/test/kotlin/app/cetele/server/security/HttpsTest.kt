package app.cetele.server.security

import app.cetele.server.config.LocalOnlyAdapterGuard
import app.cetele.server.config.SecurityConfig
import app.cetele.server.config.TransportSecurityProperties
import app.cetele.server.web.problem.ProblemWriter
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.boot.env.YamlPropertySourceLoader
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.core.io.ClassPathResource
import org.springframework.http.HttpHeaders
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.mock.web.MockServletContext
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.request.RequestPostProcessor
import org.springframework.test.web.servlet.setup.DefaultMockMvcBuilder
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext
import org.springframework.web.servlet.config.annotation.EnableWebMvc
import tools.jackson.databind.json.JsonMapper
import java.security.KeyPairGenerator
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.time.Clock
import java.time.Duration
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * `cetele.security.require-https=true` (the default outside `local`/`test`): every plain-HTTP
 * request is redirected to HTTPS before anything else happens. Runs the real [SecurityConfig] in
 * a small web context, so the shared integration context (plain HTTP in profile `test`) stays as is.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class HttpsTest {
    private lateinit var context: AnnotationConfigWebApplicationContext
    private lateinit var mvc: MockMvc

    @BeforeAll
    fun start() {
        context = webContext(requireHttps = true)
        mvc = mockMvc(context)
    }

    private fun webContext(
        requireHttps: Boolean,
        vararg profiles: String,
    ) = AnnotationConfigWebApplicationContext().apply {
        servletContext = MockServletContext()
        environment.setActiveProfiles(*profiles)
        register(HttpsOnlyConfiguration::class.java)
        addBeanFactoryPostProcessor { it.registerSingleton("transportSecurityProperties", TransportSecurityProperties(requireHttps)) }
        refresh()
    }

    private fun mockMvc(context: AnnotationConfigWebApplicationContext): MockMvc =
        MockMvcBuilders.webAppContextSetup(context).apply<DefaultMockMvcBuilder>(springSecurity()).build()

    @AfterAll
    fun stop() {
        context.close()
    }

    @Test
    fun `plain http requests are redirected to https`() {
        listOf("/actuator/health", "/v1/me").forEach { path ->
            val response = mvc.get(path).andReturn().response
            assertTrue(response.status in 300..399, "GET $path answered ${response.status}")
            assertEquals("https://localhost$path", response.getHeader(HttpHeaders.LOCATION))
        }
        val otp = mvc.post("/v1/auth/otp/request").andReturn().response
        assertTrue(otp.status in 300..399)
    }

    @Test
    fun `a production profile keeps https on even when local or test turned it off`() {
        assertTrue(LocalOnlyAdapterGuard.requireHttps(false, listOf("prod", "local")))
        assertTrue(LocalOnlyAdapterGuard.requireHttps(false, listOf("staging", "test")))
        assertFalse(LocalOnlyAdapterGuard.requireHttps(false, listOf("local")))
        assertTrue(LocalOnlyAdapterGuard.requireHttps(true, listOf("test")))
        listOf(arrayOf("prod", "local"), arrayOf("staging", "test")).forEach { profiles ->
            webContext(false, *profiles).use { mixed ->
                val response = mockMvc(mixed).get("/v1/me").andReturn().response
                assertTrue(response.status in 300..399, "${profiles.toList()} answered ${response.status}")
                assertEquals("https://localhost/v1/me", response.getHeader(HttpHeaders.LOCATION))
            }
        }
        webContext(false, "local").use { local ->
            assertEquals(
                401,
                mockMvc(local)
                    .get("/v1/me")
                    .andReturn()
                    .response.status,
            )
        }
    }

    @Test
    fun `secure requests are not redirected`() {
        // What Tomcat reports for a TLS request, or for X-Forwarded-Proto https from a trusted proxy.
        val https =
            RequestPostProcessor { request ->
                request.apply {
                    scheme = "https"
                    serverPort = 443
                    isSecure = true
                }
            }
        val health = mvc.get("/actuator/health") { with(https) }.andReturn().response
        assertTrue(health.status !in 300..399, "secure request answered ${health.status}")
        val me = mvc.get("/v1/me") { with(https) }.andReturn().response
        assertEquals(401, me.status)
        assertEquals(SecurityHeadersConfig.HSTS, me.getHeader("Strict-Transport-Security"))
    }

    @Test
    fun `https is required by default and relaxed only for local and test`() {
        assertTrue(TransportSecurityProperties().requireHttps)
        val documents = YamlPropertySourceLoader().load("application", ClassPathResource("application.yml"))
        val base = documents.first()
        assertEquals(true, base.getProperty("cetele.security.require-https"))
        val relaxed = documents.filter { it.getProperty("cetele.security.require-https") == false }
        assertEquals(1, relaxed.size)
        assertEquals("local | test", relaxed.single().getProperty("spring.config.activate.on-profile").toString())
    }

    // Test configuration: never picked up by the component scan of the shared integration context.
    @TestConfiguration(proxyBeanMethods = false)
    @EnableWebMvc
    @EnableWebSecurity
    @Import(SecurityConfig::class)
    class HttpsOnlyConfiguration {
        @Bean
        fun problemWriter() = ProblemWriter(JsonMapper())

        @Bean
        fun jdbcTemplate() = JdbcTemplate(DriverManagerDataSource())

        @Bean
        fun jwtCodec(): JwtCodec {
            val keys = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
            return JwtCodec(
                keys.private as ECPrivateKey,
                keys.public as ECPublicKey,
                "https://cetele.app",
                Duration.ofMinutes(15),
                Duration.ofSeconds(30),
                Clock.systemUTC(),
            )
        }
    }
}
