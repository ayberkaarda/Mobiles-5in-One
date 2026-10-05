package app.cetele.server.support

import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import

/**
 * One shared application context for all integration tests: the full app on a mock servlet
 * environment, backed by a Testcontainers PostgreSQL. Keeping a single annotation set means
 * Spring caches one context and starts one database container per test run.
 */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgresTestConfiguration::class)
annotation class IntegrationTest
