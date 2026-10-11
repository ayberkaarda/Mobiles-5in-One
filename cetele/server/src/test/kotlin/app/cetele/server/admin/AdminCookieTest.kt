package app.cetele.server.admin

import app.cetele.server.support.MinioTestConfiguration
import app.cetele.server.support.PostgresTestConfiguration
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.test.context.ActiveProfiles
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The console cookie as a real Tomcat writes it (MockMvc never emits the session cookie), so this
 * class runs the application on a random port in its own context.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import(PostgresTestConfiguration::class, MinioTestConfiguration::class)
class AdminCookieTest {
    @LocalServerPort
    private var port: Int = 0

    private val client: HttpClient = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()

    @Test
    fun `cookie name and attributes`() {
        val response = get("/admin/login")
        assertEquals(200, response.statusCode())
        val cookies = response.headers().allValues("Set-Cookie")
        assertEquals(1, cookies.size, "one session cookie: $cookies")
        val cookie = cookies.single()
        val attributes = cookie.split(';').map { it.trim() }
        assertTrue(attributes.first().startsWith("${AdminSessionPolicy.COOKIE_NAME}="), cookie)
        assertTrue("Path=/" in attributes, cookie)
        assertTrue(attributes.any { it.equals("Secure", ignoreCase = true) }, cookie)
        assertTrue(attributes.any { it.equals("HttpOnly", ignoreCase = true) }, cookie)
        assertTrue("SameSite=Strict" in attributes, cookie)
        assertFalse(attributes.any { it.startsWith("Domain", ignoreCase = true) }, cookie)
        assertFalse(response.body().contains("jsessionid", ignoreCase = true), "the session id is never put in a URL")
    }

    @Test
    fun `the api never creates a session`() {
        val health = get("/actuator/health")
        assertEquals(200, health.statusCode())
        assertTrue(health.headers().allValues("Set-Cookie").isEmpty())
        val api = get("/v1/me")
        assertEquals(401, api.statusCode())
        assertTrue(api.headers().allValues("Set-Cookie").isEmpty())
    }

    @Test
    fun `anonymous console requests are redirected without a session in the url`() {
        val response = get("/admin/shops")
        assertEquals(302, response.statusCode())
        assertEquals("/admin/login", response.headers().firstValue("Location").orElse(""))
    }

    private fun get(path: String): HttpResponse<String> =
        client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).GET().build(), HttpResponse.BodyHandlers.ofString())
}
