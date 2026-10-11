package app.cetele.server.security.attack

import app.cetele.server.admin.AdminAccountRepository
import app.cetele.server.admin.AdminPasswords
import app.cetele.server.admin.AdminRole
import app.cetele.server.admin.AdminSessionPolicy
import app.cetele.server.admin.AdminTestSupport
import app.cetele.server.admin.TestAdmin
import app.cetele.server.admin.totp.TotpCipher
import app.cetele.server.admin.totp.TotpService
import app.cetele.server.billing.play.FakePlayDeveloperApi
import app.cetele.server.statements.link.StatementLinkService
import app.cetele.server.tenancy.Actor
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.net.URI
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The public and semi-public surfaces over real HTTP: statement-token guessing and enumeration,
 * the admin console boundary (reachable only with its own session cookie, never with an API token,
 * and the API never with the console cookie), and linking another shop's purchase token.
 */
@AttackTest
class PublicSurfaceAttackTest : AttackSupport() {
    @Autowired lateinit var links: StatementLinkService

    @Autowired lateinit var accounts: AdminAccountRepository

    @Autowired lateinit var passwords: AdminPasswords

    @Autowired lateinit var cipher: TotpCipher

    @Autowired lateinit var totp: TotpService

    private val random = SecureRandom()

    private val admins by lazy { AdminTestSupport(mvc, accounts, passwords, cipher, totp, jdbc) }

    private class Statement(
        val shopId: UUID,
        val customer: UUID,
        val token: String,
    )

    private fun statement(): Statement {
        val owner = tenancy.actor()
        val shopId = tenancy.shop(owner)
        val customer = ledger.customer(shopId, name = "Gizli Müşteri")
        ledger.entry(shopId, customer)
        val issued = links.issue(shopId, customer, owner.id, now = clock.instant())
        return Statement(shopId, customer, issued.token)
    }

    private fun guessToken(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(random::nextBytes))

    private fun page(
        token: String,
        peer: String = RawHttp.TRUSTED_PROXY,
        client: String? = RawHttp.randomClient(),
    ) = get("/s/$token", peer = peer, forwardedFor = client)

    /** The not-found page without its per-request CSP nonce. */
    private fun normalised(response: RawHttp.Response): String = response.text.replace(NONCE, "nonce=\"\"")

    @Test
    fun `guessed, near-miss, revoked and expired statement tokens get one identical not found page`() {
        val live = statement()
        assertEquals(200, page(live.token).status, "control: the real link opens")
        val revoked = statement()
        jdbc.update("UPDATE statement_links SET revoked_at = now() WHERE shop_id = ?", revoked.shopId)
        val expired = statement()
        jdbc.update(
            "UPDATE statement_links SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE shop_id = ?",
            expired.shopId,
        )
        val flipped = live.token.dropLast(1) + (if (live.token.last() == 'A') 'B' else 'A')
        val candidates =
            List(25) { guessToken() } +
                listOf(flipped, live.token.dropLast(1), live.token + "A", live.token.uppercase(), revoked.token, expired.token)
        val pages = candidates.map { page(it) }
        pages.forEachIndexed { i, response ->
            assertEquals(404, response.status, "candidate $i")
            assertFalse(response.text.contains("Gizli Müşteri"), "candidate $i shows a customer")
        }
        assertEquals(1, pages.map { normalised(it) }.toSet().size, "every unusable token renders the same page")
        assertEquals(setOf("noindex, nofollow"), pages.map { it.header("X-Robots-Tag") }.toSet())
        assertEquals(setOf("no-store"), pages.map { it.header("Cache-Control") }.toSet())
    }

    @Test
    fun `hostile statement paths never reach a server error`() {
        listOf("..%2F..%2Fadmin", "%00", "a".repeat(10_000), "%E2%80%AE", "<script>", "'%20OR%201=1--", "*", "%25").forEach { token ->
            val response = page(token)
            assertTrue(response.status in 400..499, "token '${token.take(16)}' answered $response")
            assertNoInternals(response, token.take(16))
        }
    }

    @Test
    fun `statement guessing from one client is cut off at sixty per minute even with a spoofed X-Forwarded-For`() {
        val client = "192.0.2.${1 + random.nextInt(250)}"
        val throughProxy = (1..61).map { page(guessToken(), client = client) }
        throughProxy.take(60).forEach { assertEquals(404, it.status) }
        assertEquals(429, throughProxy.last().status)
        assertNotNull(throughProxy.last().header("Retry-After"))

        val spoofed = (1..61).map { page(guessToken(), peer = UNTRUSTED_STATEMENT, client = "203.0.113.${it % 250}") }
        spoofed.take(60).forEach { assertEquals(404, it.status) }
        assertEquals(429, spoofed.last().status)
    }

    /** A full console sign-in over real HTTP: login form, password, TOTP; returns the session cookie. */
    private fun consoleSession(admin: TestAdmin): String {
        val client = RawHttp.randomClient()
        val form = get("/admin/login", forwardedFor = client)
        assertEquals(200, form.status)
        var cookie = cookieOf(form)
        val first = formPost("/admin/login", cookie, client, csrf(form), "email" to admin.email, "password" to admin.password)
        assertEquals("/admin/login/totp", location(first), first.toString())
        cookie = cookieOf(first) ?: cookie
        val totpForm = call("GET", "/admin/login/totp", headers = mapOf("Cookie" to checkNotNull(cookie)), forwardedFor = client)
        cookie = cookieOf(totpForm) ?: cookie
        val second = formPost("/admin/login/totp", cookie, client, csrf(totpForm), "code" to admins.code(checkNotNull(admin.secret)))
        assertEquals("/admin", location(second), second.toString())
        return checkNotNull(cookieOf(second) ?: cookie)
    }

    private fun formPost(
        path: String,
        cookie: String?,
        client: String,
        csrf: String?,
        vararg fields: Pair<String, String>,
    ): RawHttp.Response {
        val all = fields.toList() + listOfNotNull(csrf?.let { "_csrf" to it })
        val body = all.joinToString("&") { (k, v) -> k + "=" + URLEncoder.encode(v, Charsets.UTF_8) }
        val headers = mutableMapOf("Content-Type" to "application/x-www-form-urlencoded")
        if (cookie != null) headers["Cookie"] = cookie
        return http.exchange("POST", path, headers, body.toByteArray(Charsets.UTF_8), forwardedFor = client)
    }

    private fun cookieOf(response: RawHttp.Response): String? =
        response.headers("Set-Cookie").firstOrNull { it.startsWith(AdminSessionPolicy.COOKIE_NAME + "=") }?.substringBefore(';')

    private fun location(response: RawHttp.Response): String? = response.header("Location")?.let { URI.create(it).path }

    private fun csrf(response: RawHttp.Response): String? = CSRF.find(response.text)?.groupValues?.get(1)

    private fun console(
        path: String,
        cookie: String? = null,
        bearer: String? = null,
    ): RawHttp.Response {
        val headers = mutableMapOf<String, String>()
        cookie?.let { headers["Cookie"] = it }
        bearer?.let { headers["Authorization"] = it }
        return call("GET", path, headers = headers)
    }

    @Test
    fun `console pages answer only to a console session`() {
        val api = auth.bearer(auth.user())
        val forged =
            AdminSessionPolicy.COOKIE_NAME + "=" +
                UUID
                    .randomUUID()
                    .toString()
                    .replace("-", "")
                    .uppercase()
        CONSOLE_PAGES.forEach { path ->
            listOf(
                "anonymous" to console(path),
                "api access token" to console(path, bearer = api),
                "forged session cookie" to console(path, cookie = forged),
            ).forEach { (who, response) ->
                assertEquals(302, response.status, "$who on $path")
                assertEquals("/admin/login", location(response), "$who on $path")
            }
        }
    }

    @Test
    fun `a console session opens the console but never the api`() {
        val admin = admins.admin(AdminRole.ADMIN)
        val cookie = consoleSession(admin)
        assertEquals(200, console("/admin", cookie).status, "control: the session opens the console")
        val shop = tenancy.shop(tenancy.actor())
        listOf("/v1/me", "/v1/shops/$shop", "/v1/shops/$shop/billing").forEach { path ->
            assertProblem(console(path, cookie), 401, "auth.unauthenticated", "console cookie on $path")
            assertProblem(
                console(path, bearer = "Bearer " + cookie.substringAfter('=')),
                401,
                "auth.unauthenticated",
                "session id as bearer",
            )
        }
    }

    @Test
    fun `console state changes need the csrf token and support cannot reach admin pages`() {
        val admin = admins.admin(AdminRole.ADMIN)
        val cookie = consoleSession(admin)
        val target = auth.user()
        val refused = formPost("/admin/users/$target/deactivate", cookie, RawHttp.randomClient(), csrf = null)
        assertEquals(403, refused.status, refused.toString())
        assertNull(jdbc.queryForObject("SELECT deactivated_at FROM users WHERE id = ?", java.sql.Timestamp::class.java, target))

        val support = consoleSession(admins.admin(AdminRole.SUPPORT))
        assertEquals(200, console("/admin/shops", support).status, "control: support reads the shop list")
        listOf("/admin/audit", "/admin/admins", "/admin/admins/new").forEach { path ->
            assertEquals(403, console(path, support).status, "support on $path")
        }
    }

    private fun link(
        shopId: UUID,
        actor: Actor,
        token: String,
    ) = post("/v1/shops/$shopId/billing/link", """{"productId":"cetele_pro","purchaseToken":"$token"}""", actor.bearer)

    private fun plan(shopId: UUID) = jdbc.queryForObject("SELECT plan FROM shops WHERE id = ?", String::class.java, shopId)

    private fun subscriptions(shopId: UUID) =
        jdbc.queryForObject("SELECT count(*) FROM subscriptions WHERE shop_id = ?", Int::class.java, shopId)!!

    @Test
    fun `another shop's purchase token cannot be linked`() {
        val attacker = tenancy.world()
        val victim = tenancy.world()
        // A purchase made for the victim's shop and not yet linked anywhere.
        val unlinked = FakePlayDeveloperApi.token("active", victim.shopId, "unlinked")
        assertProblem(link(attacker.shopId, attacker.owner, unlinked), 409, "billing.token_in_use", "purchase made for another shop")
        // A purchase the victim already linked.
        val linked = FakePlayDeveloperApi.token("active", victim.shopId, "linked")
        assertEquals(200, link(victim.shopId, victim.owner, linked).status)
        assertProblem(link(attacker.shopId, attacker.owner, linked), 409, "billing.token_in_use", "purchase linked to another shop")
        // Staff of the attacker's shop and the attacker on the victim's path.
        val own = FakePlayDeveloperApi.token("active", attacker.shopId, "own")
        assertProblem(link(attacker.shopId, attacker.staff, own), 403, "forbidden", "staff links a purchase")
        assertProblem(link(victim.shopId, attacker.owner, own), 404, "not_found", "attacker on the victim's path")
        assertEquals("FREE", plan(attacker.shopId))
        assertEquals(0, subscriptions(attacker.shopId))
        assertEquals("PRO", plan(victim.shopId))
        assertEquals(1, subscriptions(victim.shopId))
    }

    private companion object {
        val NONCE = Regex("""nonce="[^"]*"""")
        val CSRF = Regex("""name="_csrf"\s+value="([^"]+)"""")
        val CONSOLE_PAGES =
            listOf("/admin", "/admin/shops", "/admin/shops/${UUID.randomUUID()}", "/admin/users", "/admin/audit", "/admin/admins")
    }
}
