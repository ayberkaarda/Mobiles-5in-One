package app.cetele.server.security.attack

import app.cetele.server.auth.integrity.FakeIntegrityVerifier
import app.cetele.server.auth.token.RefreshTokenService
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.security.JwtCodec
import app.cetele.server.support.TestUsers
import com.jayway.jsonpath.JsonPath
import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.ECDSASigner
import com.nimbusds.jose.crypto.MACSigner
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.security.SecureRandom
import java.time.Duration
import java.util.Base64
import java.util.Date
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Sign-in and session attacks over real HTTP: OTP brute force and lockout, integrity-token bypass,
 * spoofed `X-Forwarded-For` against the sign-in buckets, forged and tampered access tokens, and
 * refresh-token reuse.
 */
@AttackTest
class AuthAttackTest : AttackSupport() {
    @Autowired lateinit var gateway: SmsGateway

    private val sms: FakeSmsGateway get() = gateway as FakeSmsGateway

    private fun requestOtp(
        phone: String,
        device: UUID,
        integrity: String? = FakeIntegrityVerifier.OK,
        peer: String = RawHttp.TRUSTED_PROXY,
        client: String? = RawHttp.randomClient(),
    ): RawHttp.Response {
        val token = if (integrity == null) "" else ""","integrityToken":${quote(integrity)}"""
        return call(
            "POST",
            "/v1/auth/otp/request",
            json = """{"phone":"$phone","deviceId":"$device"$token}""",
            peer = peer,
            forwardedFor = client,
        )
    }

    private fun verifyOtp(
        phone: String,
        device: UUID,
        code: String,
        peer: String = RawHttp.TRUSTED_PROXY,
        client: String? = RawHttp.randomClient(),
    ) = call(
        "POST",
        "/v1/auth/otp/verify",
        json = """{"phone":"$phone","deviceId":"$device","code":"$code","model":"Pixel 8","appVersion":"1.0.0"}""",
        peer = peer,
        forwardedFor = client,
    )

    private fun refresh(token: String) = post("/v1/auth/refresh", """{"refreshToken":"$token"}""")

    private fun lastCode(phone: String): String {
        val text = assertNotNull(sms.lastMessageTo(phone), "no SMS for the phone").text
        return assertNotNull(CODE.find(text)).value
    }

    private fun otherCode(code: String) = ((code.toInt() + 1) % 1_000_000).toString().padStart(6, '0')

    private class Session(
        val access: String,
        val refresh: String,
    )

    private fun signIn(
        phone: String = TestUsers.phone(),
        device: UUID = id(),
    ): Session {
        assertEquals(202, requestOtp(phone, device).status)
        val verified = verifyOtp(phone, device, lastCode(phone))
        assertEquals(200, verified.status, verified.toString())
        return Session(JsonPath.read(verified.text, "$.accessToken"), JsonPath.read(verified.text, "$.refreshToken"))
    }

    @Test
    fun `otp brute force burns the code after five wrong guesses`() {
        val phone = TestUsers.phone()
        val device = id()
        val client = RawHttp.randomClient()
        assertEquals(202, requestOtp(phone, device, client = client).status)
        val code = lastCode(phone)
        repeat(5) { assertProblem(verifyOtp(phone, device, otherCode(code), client = client), 401, "auth.otp_invalid", "guess ${it + 1}") }
        assertProblem(verifyOtp(phone, device, code, client = client), 401, "auth.otp_invalid", "right code after the lockout")
        val row = jdbc.queryForMap("SELECT attempts, consumed_at FROM otp_codes WHERE phone_e164 = ?", phone)
        assertEquals(5, row["attempts"])
        assertNotNull(row["consumed_at"])
        assertNull(jdbc.queryForList("SELECT id FROM users WHERE phone_e164 = ?", phone).firstOrNull(), "no account was created")
    }

    @Test
    fun `an attacker rotating client addresses gets fifteen guesses per phone in ten minutes`() {
        // Measures finding F-01: the per-phone budget is 3 codes x 5 attempts; no longer ceiling exists.
        val phone = TestUsers.phone()
        val device = id()
        var evaluated = 0
        repeat(3) { round ->
            assertEquals(202, requestOtp(phone, device).status, "code ${round + 1}")
            val code = lastCode(phone)
            repeat(5) {
                assertProblem(verifyOtp(phone, device, otherCode(code)), 401, "auth.otp_invalid", "round ${round + 1}")
                evaluated++
            }
        }
        assertProblem(requestOtp(phone, device), 429, "rate_limited", "fourth code inside the window")
        assertEquals(15, evaluated)
        assertEquals(
            15,
            jdbc.queryForObject("SELECT coalesce(sum(attempts), 0) FROM otp_codes WHERE phone_e164 = ?", Int::class.java, phone),
        )
    }

    @Test
    fun `rotating a spoofed X-Forwarded-For does not escape the per address verify bucket`() {
        val answers =
            (1..21).map {
                verifyOtp(TestUsers.phone(), id(), "000000", peer = UNTRUSTED_OTP_VERIFY, client = "203.0.113.$it")
            }
        answers.take(20).forEachIndexed { i, response -> assertProblem(response, 401, "auth.otp_invalid", "verify ${i + 1}") }
        assertProblem(answers.last(), 429, "rate_limited", "verify 21")
        assertTrue(
            answers
                .last()
                .header("Retry-After")
                .orEmpty()
                .toLong() > 0,
        )
    }

    @Test
    fun `a spoofed left-most X-Forwarded-For entry behind the trusted proxy does not open new buckets`() {
        val realClient = "192.0.2.${10 + SecureRandom().nextInt(200)}"
        val answers = (1..11).map { requestOtp(TestUsers.phone(), id(), client = "198.18.0.$it, $realClient") }
        answers.take(10).forEach { assertEquals(202, it.status, it.toString()) }
        assertProblem(answers.last(), 429, "rate_limited", "eleventh request of one real client")
    }

    @Test
    fun `an untrusted peer cannot pick its bucket with X-Forwarded-For on otp request`() {
        val answers =
            (1..11).map {
                requestOtp(TestUsers.phone(), id(), peer = UNTRUSTED_OTP_REQUEST, client = "203.0.113.${100 + it}")
            }
        answers.take(10).forEach { assertEquals(202, it.status, it.toString()) }
        assertProblem(answers.last(), 429, "rate_limited", "eleventh request from one untrusted peer")
    }

    @Test
    fun `the per phone limit holds across client addresses`() {
        val phone = TestUsers.phone()
        repeat(3) { assertEquals(202, requestOtp(phone, id()).status) }
        val fourth = requestOtp(phone, id())
        assertProblem(fourth, 429, "rate_limited", "fourth request for one phone")
        assertNotNull(fourth.header("Retry-After"))
        assertEquals(3, sms.messagesTo(phone).size)
    }

    @Test
    fun `integrity token bypass attempts are refused and send no sms`() {
        val required = listOf<String?>(null, "", "   ")
        val invalid =
            listOf(
                "fake.OK",
                "fake.ok ",
                "eyJhbGciOiJub25lIn0.e30.",
                FakeIntegrityVerifier.UNRECOGNIZED_APP,
                FakeIntegrityVerifier.NO_DEVICE_INTEGRITY,
                FakeIntegrityVerifier.PACKAGE_MISMATCH,
                FakeIntegrityVerifier.OK + "x".repeat(16_384),
            )
        required.forEach { token ->
            val phone = TestUsers.phone()
            assertProblem(requestOtp(phone, id(), token), 403, "auth.integrity_required", "token '${token?.take(20)}'")
            assertTrue(sms.messagesTo(phone).isEmpty())
        }
        invalid.forEach { token ->
            val phone = TestUsers.phone()
            assertProblem(requestOtp(phone, id(), token), 403, "auth.integrity_invalid", "token '${token.take(20)}'")
            assertTrue(sms.messagesTo(phone).isEmpty())
        }
        // An explicit JSON null is the same as a missing token.
        val phone = TestUsers.phone()
        val explicitNull = post("/v1/auth/otp/request", """{"phone":"$phone","deviceId":"${id()}","integrityToken":null}""")
        assertProblem(explicitNull, 403, "auth.integrity_required", "integrityToken null")
        assertTrue(sms.messagesTo(phone).isEmpty())
    }

    @Test
    fun `forged and tampered access tokens are 401`() {
        val user = auth.user()
        val genuine = auth.token(user)
        assertEquals(200, get("/v1/me", "Bearer $genuine").status, "control: the genuine token works")
        val (header, payload, signature) = genuine.split('.')
        val attackerKey = ECKeyGenerator(Curve.P_256).keyID(JwtCodec.KEY_ID).generate()
        val otherUser = auth.user()
        val forged =
            mapOf(
                "alg none without signature" to "${b64("""{"alg":"none","typ":"JWT"}""")}.$payload.",
                "alg none keeping the signature" to "${b64("""{"alg":"none","kid":"es256-1"}""")}.$payload.$signature",
                "HS256 with a guessed secret" to hs256(claims(user)),
                "ES256 with the attacker's key and the real kid" to es256(claims(user), attackerKey.toECPrivateKey(), JwtCodec.KEY_ID),
                "ES256 with the attacker's key embedded as jwk" to
                    SignedJWT(
                        JWSHeader
                            .Builder(JWSAlgorithm.ES256)
                            .keyID(JwtCodec.KEY_ID)
                            .jwk(attackerKey.toPublicJWK())
                            .build(),
                        claims(user),
                    ).apply { sign(ECDSASigner(attackerKey)) }
                        .serialize(),
                "kid changed to another key id" to "${b64("""{"kid":"es256-2","typ":"JWT","alg":"ES256"}""")}.$payload.$signature",
                "kid path traversal" to es256(claims(user), attackerKey.toECPrivateKey(), "../../../../dev/null"),
                "kid removed" to "${b64("""{"typ":"JWT","alg":"ES256"}""")}.$payload.$signature",
                "subject swapped to another user" to "$header.${swapSubject(payload, otherUser)}.$signature",
                "signature stripped" to "$header.$payload.",
                "signature of another token" to "$header.$payload.${auth.token(otherUser).split('.')[2]}",
                "expired twenty minutes ago" to auth.token(user, now = clock.instant().minus(Duration.ofMinutes(20))),
                "issued ten minutes in the future" to auth.token(user, now = clock.instant().plus(Duration.ofMinutes(10))),
                "oversize" to genuine + "A".repeat(5_000),
                "not a jwt" to "this-is-not-a-token",
            )
        forged.forEach { (name, token) ->
            assertProblem(get("/v1/me", "Bearer $token"), 401, "auth.unauthenticated", name)
        }
        listOf("Basic dXNlcjpwYXNz", "Bearer", "Token $genuine", genuine).forEach { header ->
            assertProblem(call("GET", "/v1/me", bearer = header), 401, "auth.unauthenticated", "Authorization '${header.take(12)}'")
        }
        auth.deactivate(user)
        assertProblem(get("/v1/me", "Bearer $genuine"), 401, "auth.unauthenticated", "token of a deactivated user")
    }

    @Test
    fun `refresh token reuse revokes the whole family`() {
        val phone = TestUsers.phone()
        val stolen = signIn(phone)
        val otherDevice = signIn(phone)
        val rotated = refresh(stolen.refresh)
        assertEquals(200, rotated.status, rotated.toString())
        val second = JsonPath.read<String>(rotated.text, "$.refreshToken")

        // The thief replays the old token: the family dies, including the legitimate new token.
        assertProblem(refresh(stolen.refresh), 401, "auth.refresh_invalid", "replayed refresh token")
        assertProblem(refresh(second), 401, "auth.refresh_invalid", "rotated token after the replay")
        val family =
            jdbc.queryForObject(
                "SELECT family_id FROM refresh_tokens WHERE token_hash = ?",
                UUID::class.java,
                RefreshTokenService.hash(second),
            )
        assertEquals(
            0,
            jdbc.queryForObject("SELECT count(*) FROM refresh_tokens WHERE family_id = ? AND revoked_at IS NULL", Int::class.java, family),
        )
        // Another device of the same user keeps its own family.
        assertEquals(200, refresh(otherDevice.refresh).status)
    }

    @Test
    fun `tokens are not interchangeable and logout ends the refresh family`() {
        val session = signIn()
        assertProblem(get("/v1/me", "Bearer ${session.refresh}"), 401, "auth.unauthenticated", "refresh token as access token")
        // An access JWT is longer than any refresh token, so it fails the shape check before any lookup.
        assertProblem(refresh(session.access), 422, "validation.failed", "access token as refresh token")
        assertEquals(204, call("POST", "/v1/auth/logout", "Bearer ${session.access}").status)
        assertProblem(refresh(session.refresh), 401, "auth.refresh_invalid", "refresh after logout")
        // Finding F-05, accepted by ADR-0005: the stateless access token lives on until its 15 minutes end.
        assertEquals(200, get("/v1/me", "Bearer ${session.access}").status)
    }

    @Test
    fun `re-authentication code brute force cannot delete a shop`() {
        val owner = tenancy.actor()
        val shopId = tenancy.shop(owner)
        val device = id()
        val bearer = auth.bearer(owner.id, device)
        assertEquals(202, call("POST", "/v1/auth/reauth/request", bearer).status)
        val code = lastCode(owner.phone)
        repeat(5) {
            val guess = call("DELETE", "/v1/shops/$shopId", bearer, """{"code":"${otherCode(code)}"}""")
            assertProblem(guess, 403, "auth.reauth_invalid", "guess ${it + 1}")
        }
        assertProblem(
            call("DELETE", "/v1/shops/$shopId", bearer, """{"code":"$code"}"""),
            403,
            "auth.reauth_invalid",
            "right code after five guesses",
        )
        // The code is bound to the device that asked for it: another session of the same user cannot use a fresh one.
        assertEquals(202, call("POST", "/v1/auth/reauth/request", bearer).status)
        val fresh = lastCode(owner.phone)
        val otherDevice = auth.bearer(owner.id, id())
        assertProblem(call("DELETE", "/v1/shops/$shopId", otherDevice, """{"code":"$fresh"}"""), 403, "auth.reauth_invalid", "other device")
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM deletion_requests WHERE shop_id = ?", Int::class.java, shopId))
        assertNull(jdbc.queryForMap("SELECT deleted_at FROM shops WHERE id = ?", shopId)["deleted_at"])
    }

    private fun claims(user: UUID): JWTClaimsSet {
        val now = clock.instant()
        return JWTClaimsSet
            .Builder()
            .issuer("https://cetele.app")
            .audience(JwtCodec.AUDIENCE)
            .subject(user.toString())
            .claim(JwtCodec.DEVICE_CLAIM, UUID.randomUUID().toString())
            .jwtID(UUID.randomUUID().toString())
            .issueTime(Date.from(now))
            .expirationTime(Date.from(now.plus(Duration.ofMinutes(15))))
            .build()
    }

    private fun es256(
        claims: JWTClaimsSet,
        key: java.security.interfaces.ECPrivateKey,
        kid: String,
    ): String =
        SignedJWT(
            JWSHeader
                .Builder(JWSAlgorithm.ES256)
                .keyID(kid)
                .type(JOSEObjectType.JWT)
                .build(),
            claims,
        ).apply { sign(ECDSASigner(key)) }.serialize()

    private fun hs256(claims: JWTClaimsSet): String =
        SignedJWT(JWSHeader.Builder(JWSAlgorithm.HS256).keyID(JwtCodec.KEY_ID).build(), claims)
            .apply { sign(MACSigner(ByteArray(32).also(SecureRandom()::nextBytes))) }
            .serialize()

    private fun swapSubject(
        payload: String,
        user: UUID,
    ): String {
        val json = String(Base64.getUrlDecoder().decode(payload), Charsets.UTF_8)
        return b64(json.replace(Regex(""""sub":"[^"]+""""), """"sub":"$user""""))
    }

    private fun b64(json: String): String = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(Charsets.UTF_8))

    private fun quote(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    private companion object {
        val CODE = Regex("""\b\d{6}\b""")
    }
}
