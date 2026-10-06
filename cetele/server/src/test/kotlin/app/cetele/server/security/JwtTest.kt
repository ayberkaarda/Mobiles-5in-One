package app.cetele.server.security

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.ECDSASigner
import com.nimbusds.jose.crypto.MACSigner
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import java.util.Date
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals

@IntegrationTest
class JwtTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
) {
    private val now: Instant = Instant.parse("2026-10-05T10:00:00Z")
    private val keys = newKeyPair()
    private val user = UUID.randomUUID()
    private val device = UUID.randomUUID()

    @Test
    fun `issued token carries exactly the contract claims`() {
        val token = codec(keys).issue(user, device, now)
        val jwt = SignedJWT.parse(token)
        assertEquals(JWSAlgorithm.ES256, jwt.header.algorithm)
        assertEquals("es256-1", jwt.header.keyID)
        assertEquals(JOSEObjectType.JWT, jwt.header.type)
        val claims = jwt.jwtClaimsSet
        assertEquals(setOf("sub", "did", "jti", "iat", "exp", "iss", "aud"), claims.claims.keys)
        assertEquals(listOf("cetele-api"), claims.audience)
        assertEquals("https://cetele.app", claims.issuer)
        assertEquals(user.toString(), claims.subject)
        assertEquals(device.toString(), claims.getStringClaim("did"))
        assertEquals(Duration.ofMinutes(15), Duration.between(claims.issueTime.toInstant(), claims.expirationTime.toInstant()))
        assertNotEquals(SignedJWT.parse(codec(keys).issue(user, device, now)).jwtClaimsSet.jwtid, claims.jwtid)
        assertEquals(CurrentUser(user, device), codec(keys).verify(token))
    }

    @Test
    fun `expiry honours a 30 second clock skew`() {
        val token = codec(keys).issue(user, device, now)
        assertEquals(CurrentUser(user, device), codec(keys, now.plus(Duration.ofMinutes(15)).plusSeconds(29)).verify(token))
        assertRejected(codec(keys, now.plus(Duration.ofMinutes(15)).plusSeconds(31)), token)
        assertRejected(codec(keys, now.minusSeconds(31)), token)
    }

    @Test
    fun `alg none is rejected`() {
        val header = base64Url("""{"alg":"none","typ":"JWT","kid":"es256-1"}""")
        val payload = base64Url(validClaims().toString())
        assertRejected(codec(keys), "$header.$payload.")
        assertRejected(codec(keys), "$header.$payload")
    }

    @Test
    fun `hmac signed token is rejected`() {
        val secret = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val jwt = SignedJWT(JWSHeader.Builder(JWSAlgorithm.HS256).keyID("es256-1").build(), validClaims())
        jwt.sign(MACSigner(secret))
        assertRejected(codec(keys), jwt.serialize())
    }

    @Test
    fun `token signed with another key is rejected`() {
        val foreign = codec(newKeyPair()).issue(user, device, now)
        assertRejected(codec(keys), foreign)
    }

    @Test
    fun `wrong key id, issuer, missing claims and tampering are rejected`() {
        assertRejected(codec(keys), sign(JWSHeader.Builder(JWSAlgorithm.ES256).keyID("es256-2").build(), validClaims()))
        assertRejected(codec(keys), sign(es256Header(), JWTClaimsSet.Builder(validClaims()).issuer("https://evil.example").build()))
        assertRejected(codec(keys), sign(es256Header(), JWTClaimsSet.Builder(validClaims()).claim("did", null).build()))
        assertRejected(codec(keys), sign(es256Header(), JWTClaimsSet.Builder(validClaims()).subject("not-a-uuid").build()))
        assertRejected(codec(keys), sign(es256Header(), JWTClaimsSet.Builder(validClaims()).jwtID(null).build()))
        val parts = codec(keys).issue(user, device, now).split(".")
        val otherPayload =
            base64Url(
                JWTClaimsSet
                    .Builder(validClaims())
                    .subject(UUID.randomUUID().toString())
                    .build()
                    .toString(),
            )
        assertRejected(codec(keys), parts[0] + "." + otherPayload + "." + parts[2])
        assertRejected(codec(keys), "garbage")
        assertRejected(codec(keys), "")
    }

    @Test
    fun `tokens without the cetele audience are rejected`() {
        assertEquals(CurrentUser(user, device), codec(keys).verify(sign(es256Header(), validClaims())))
        assertRejected(codec(keys), sign(es256Header(), JWTClaimsSet.Builder(validClaims()).audience(null as String?).build()))
        assertRejected(codec(keys), sign(es256Header(), JWTClaimsSet.Builder(validClaims()).audience("other-api").build()))
        assertRejected(
            codec(keys),
            sign(es256Header(), JWTClaimsSet.Builder(validClaims()).audience(listOf("cetele-api", "other-api")).build()),
        )
    }

    @Test
    fun `valid bearer sets the current user principal`() {
        val userId = auth.user()
        val deviceId = UUID.randomUUID()
        mvc
            .get(ProbeController.BASE + "/me") {
                header(HttpHeaders.AUTHORIZATION, auth.bearer(userId, deviceId))
            }.andExpect {
                status { isOk() }
                jsonPath("$.userId") { value(userId.toString()) }
                jsonPath("$.deviceId") { value(deviceId.toString()) }
            }
    }

    @Test
    fun `invalid bearer tokens and inactive users get 401`() {
        val active = auth.user()
        val deactivated = auth.user().also { auth.deactivate(it) }
        val unknown = UUID.randomUUID()
        val headers =
            listOf(
                auth.bearer(deactivated),
                auth.bearer(unknown),
                TestAuth.bearer(auth.token(active, now = Instant.now().minus(Duration.ofMinutes(20)))),
                TestAuth.bearer(codec(newKeyPair(), Instant.now()).issue(active, device, Instant.now())),
                "Basic " + base64Url("probe:probe"),
                "Bearer",
            )
        headers.forEach { value ->
            mvc.get(ProbeController.BASE + "/me") { header(HttpHeaders.AUTHORIZATION, value) }.andExpect {
                status { isUnauthorized() }
                jsonPath("$.code") { value(ProblemCode.AUTH_UNAUTHENTICATED.code) }
            }
        }
    }

    @Test
    fun `public auth endpoints ignore a stale bearer header`() {
        val stale = TestAuth.bearer(codec(newKeyPair(), Instant.now()).issue(UUID.randomUUID(), device, Instant.now()))
        val body =
            mvc
                .post("/v1/auth/refresh") {
                    header(HttpHeaders.AUTHORIZATION, stale)
                    contentType = MediaType.APPLICATION_JSON
                    content = "{}"
                }.andReturn()
                .response.contentAsString
        // Whatever the endpoint answers, it is not the bearer filter's rejection.
        assertFalse(body.contains(ProblemCode.AUTH_UNAUTHENTICATED.code))
    }

    private fun assertRejected(
        codec: JwtCodec,
        token: String,
    ) {
        val error = assertFailsWith<ProblemException> { codec.verify(token) }
        assertEquals(ProblemCode.AUTH_UNAUTHENTICATED, error.code)
    }

    private fun codec(
        pair: KeyPair,
        at: Instant = now,
    ) = JwtCodec(
        pair.private as ECPrivateKey,
        pair.public as ECPublicKey,
        "https://cetele.app",
        Duration.ofMinutes(15),
        Duration.ofSeconds(30),
        Clock.fixed(at, ZoneOffset.UTC),
    )

    private fun validClaims(): JWTClaimsSet =
        JWTClaimsSet
            .Builder()
            .issuer("https://cetele.app")
            .audience("cetele-api")
            .subject(user.toString())
            .claim("did", device.toString())
            .jwtID(UUID.randomUUID().toString())
            .issueTime(Date.from(now))
            .expirationTime(Date.from(now.plus(Duration.ofMinutes(15))))
            .build()

    private fun es256Header() =
        JWSHeader
            .Builder(JWSAlgorithm.ES256)
            .keyID("es256-1")
            .type(JOSEObjectType.JWT)
            .build()

    private fun sign(
        header: JWSHeader,
        claims: JWTClaimsSet,
    ): String = SignedJWT(header, claims).apply { sign(ECDSASigner(keys.private as ECPrivateKey)) }.serialize()

    private fun base64Url(text: String) = Base64.getUrlEncoder().withoutPadding().encodeToString(text.toByteArray())

    companion object {
        fun newKeyPair(): KeyPair =
            KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    }
}
