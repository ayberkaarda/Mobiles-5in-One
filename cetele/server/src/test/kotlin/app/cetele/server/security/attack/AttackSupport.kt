package app.cetele.server.security.attack

import app.cetele.server.ledger.LedgerFixtures
import app.cetele.server.support.MinioTestConfiguration
import app.cetele.server.support.PostgresTestConfiguration
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures
import com.jayway.jsonpath.JsonPath
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import java.time.Clock
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Delivery-report secret of the attack context; a fixture value, never a real provider secret. */
internal const val ATTACK_DLR_SECRET = "attack-suite-dlr-secret-not-for-production"

/** The delivery-report allowlist of the attack context (TEST-NET-2). */
internal const val ATTACK_DLR_NETWORK = "198.51.100.0/24"

/**
 * One application context for the whole attack suite (spec section 6 item 23): the full
 * application on a real Tomcat port, PostgreSQL and MinIO in Testcontainers, profile `test`.
 * Attacks go over real HTTP through [RawHttp]; fixtures are set up through MockMvc and SQL, as the
 * other integration tests do. `127.0.0.2` is the only trusted proxy; delivery reports are accepted
 * from [ATTACK_DLR_NETWORK] only.
 */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = [
        "CETELE_TRUSTED_PROXIES=127\\.0\\.0\\.2",
        "cetele.sms.dlr.secret=$ATTACK_DLR_SECRET",
        "cetele.sms.dlr.allowed-ips=$ATTACK_DLR_NETWORK",
    ],
)
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(PostgresTestConfiguration::class, MinioTestConfiguration::class, TestAuth::class)
annotation class AttackTest

/** Shared helpers of the attack test classes. */
abstract class AttackSupport {
    @LocalServerPort
    var port: Int = 0

    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var auth: TestAuth

    @Autowired lateinit var jdbc: JdbcTemplate

    @Autowired lateinit var clock: Clock

    val http: RawHttp by lazy { RawHttp(port) }

    val tenancy: TenancyFixtures by lazy { TenancyFixtures(mvc, auth, jdbc) }

    val ledger: LedgerFixtures by lazy { LedgerFixtures(jdbc, clock) }

    fun call(
        method: String,
        path: String,
        bearer: String? = null,
        json: String? = null,
        peer: String = RawHttp.TRUSTED_PROXY,
        forwardedFor: String? = RawHttp.randomClient(),
        headers: Map<String, String> = emptyMap(),
    ): RawHttp.Response {
        val all = headers.toMutableMap()
        if (bearer != null) all["Authorization"] = bearer
        if (json != null) all.putIfAbsent("Content-Type", "application/json")
        return http.exchange(method, path, all, json?.toByteArray(Charsets.UTF_8), peer, forwardedFor)
    }

    fun get(
        path: String,
        bearer: String? = null,
        peer: String = RawHttp.TRUSTED_PROXY,
        forwardedFor: String? = RawHttp.randomClient(),
    ) = call("GET", path, bearer, peer = peer, forwardedFor = forwardedFor)

    fun post(
        path: String,
        json: String?,
        bearer: String? = null,
        forwardedFor: String? = RawHttp.randomClient(),
    ) = call("POST", path, bearer, json, forwardedFor = forwardedFor)

    fun id(): UUID = UUID.randomUUID()

    companion object {
        /** Untrusted peers, one per test that needs a stable source address of its own. */
        const val UNTRUSTED_OTP_VERIFY = "127.0.0.3"
        const val UNTRUSTED_STATEMENT = "127.0.0.4"
        const val UNTRUSTED_DLR = "127.0.0.5"
        const val UNTRUSTED_OTP_REQUEST = "127.0.0.6"

        fun code(response: RawHttp.Response): String? = runCatching { JsonPath.read<String>(response.text, "$.code") }.getOrNull()

        /** Asserts a registry problem: status, code, problem media type, and nothing internal in the body. */
        fun assertProblem(
            response: RawHttp.Response,
            status: Int,
            problemCode: String,
            context: String = "",
        ) {
            assertEquals(status, response.status, "$context: $response")
            assertEquals(problemCode, code(response), "$context: $response")
            assertTrue(response.header("Content-Type").orEmpty().startsWith("application/problem+json"), "$context: content type")
            assertNoInternals(response, context)
        }

        /** No stack trace, exception class or framework name ever reaches a client. */
        fun assertNoInternals(
            response: RawHttp.Response,
            context: String = "",
        ) {
            val text = response.text
            INTERNAL_MARKERS.forEach { marker -> assertFalse(text.contains(marker), "$context: response leaks '$marker'") }
        }

        /** The problem body without its per-request trace id, for "same answer" comparisons. */
        fun shape(response: RawHttp.Response): Map<String, Any?> =
            JsonPath.read<Map<String, Any?>>(response.text, "$").filterKeys { it != "traceId" }

        private val INTERNAL_MARKERS =
            listOf("Exception", "at app.cetele", "at org.springframework", "jackson", "hibernate", "SQLState", "org.postgresql")
    }
}
