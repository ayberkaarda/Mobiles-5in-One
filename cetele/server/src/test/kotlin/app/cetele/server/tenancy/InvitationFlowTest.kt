package app.cetele.server.tenancy

import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import app.cetele.server.tenancy.TenancyFixtures.Companion.withoutTraceId
import app.cetele.server.tenancy.invitation.InvitationCode
import app.cetele.server.tenancy.invitation.InvitationCodeHasher
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.security.MessageDigest
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Invitations (spec story 2) and member management, through the HTTP API. */
@IntegrationTest
class InvitationFlowTest(
    @Autowired private val mvc: MockMvc,
    @Autowired auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val hasher: InvitationCodeHasher,
) {
    private val fixtures = TenancyFixtures(mvc, auth, jdbc)

    private fun invite(
        shopId: UUID,
        owner: Actor,
        phone: String,
    ) = mvc.post("/v1/shops/$shopId/invitations") {
        header(AUTHORIZATION, owner.bearer)
        contentType = MediaType.APPLICATION_JSON
        content = """{"phone":"$phone"}"""
    }

    private fun issueCode(
        shopId: UUID,
        owner: Actor,
        phone: String,
    ): String {
        val body =
            invite(shopId, owner, phone)
                .andExpect { status { isCreated() } }
                .andReturn()
                .response.contentAsString
        return JsonPath.read(body, "$.code")
    }

    private fun accept(
        code: String,
        caller: Actor,
    ) = mvc.post("/v1/invitations/$code/accept") { header(AUTHORIZATION, caller.bearer) }

    @Test
    fun `owner invites a phone, the holder of that phone joins as staff`() {
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val invited = fixtures.actor()

        val issued =
            invite(shopId, owner, invited.phone)
                .andExpect {
                    status { isCreated() }
                    jsonPath("$.phone") { value(invited.phone) }
                    jsonPath("$.id") { exists() }
                    jsonPath("$.expiresAt") { exists() }
                }.andReturn()
                .response.contentAsString
        val code = JsonPath.read<String>(issued, "$.code")
        assertEquals(8, code.length)
        assertTrue(code.all { it in InvitationCode.ALPHABET }, "Crockford base32 without I L O U")

        accept(code, invited).andExpect {
            status { isCreated() }
            jsonPath("$.shopId") { value(shopId.toString()) }
            jsonPath("$.role") { value("STAFF") }
        }
        assertEquals("STAFF", fixtures.roleOf(shopId, invited.id))
        mvc.get("/v1/shops/$shopId") { header(AUTHORIZATION, invited.bearer) }.andExpect {
            status { isOk() }
            jsonPath("$.role") { value("STAFF") }
        }
        val acceptedAt =
            jdbc.queryForObject(
                "SELECT accepted_at IS NOT NULL FROM invitations WHERE shop_id = ?",
                Boolean::class.java,
                shopId,
            )
        assertEquals(true, acceptedAt)
    }

    @Test
    fun `only a peppered hash of the code is stored`() {
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val code = issueCode(shopId, owner, TestUsers.phone())
        val row = jdbc.queryForMap("SELECT * FROM invitations WHERE shop_id = ?", shopId)
        assertEquals(hasher.hash(code), row["code_hash"])
        // Keyed: the unkeyed SHA-256 of the code (searchable offline from a database copy) is not what is stored.
        val unkeyed = MessageDigest.getInstance("SHA-256").digest(code.toByteArray()).joinToString("") { "%02x".format(it) }
        assertFalse(unkeyed == row["code_hash"], "the stored hash is not keyed")
        row.filterKeys { it != "phone_e164" }.values.forEach { value ->
            assertFalse(value.toString().contains(code), "the plain code is stored")
        }
    }

    @Test
    fun `a used, expired, unknown, malformed or foreign-phone code is the same 404`() {
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val invited = fixtures.actor()
        val used = issueCode(shopId, owner, invited.phone)
        accept(used, invited).andExpect { status { isCreated() } }

        val expiredHolder = fixtures.actor()
        val expired = issueCode(shopId, owner, expiredHolder.phone)
        jdbc.update(
            "UPDATE invitations SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE code_hash = ?",
            hasher.hash(expired),
        )
        val mismatchHolder = fixtures.actor()
        val mismatched = issueCode(shopId, owner, mismatchHolder.phone)

        val bodies =
            listOf(
                accept(used, invited),
                accept(used, fixtures.actor()),
                accept(expired, expiredHolder),
                accept(mismatched, fixtures.actor()),
                accept(unknownCode(), invited),
                accept("ABC", invited),
                accept("UUUUUUUU", invited),
                accept("AB-CD-EF", invited),
            ).map { withoutTraceId(it.expectProblem(404, "not_found")) }
        bodies.forEach { assertEquals(bodies.first(), it) }

        // The mismatched attempt left the invitation open for its real holder.
        accept(mismatched, mismatchHolder).andExpect { status { isCreated() } }
        assertNull(fixtures.roleOf(shopId, expiredHolder.id))
    }

    @Test
    fun `codes are read leniently the Crockford way`() {
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val invited = fixtures.actor()
        val code = issueCode(shopId, owner, invited.phone)
        val typed = code.lowercase().replace('1', 'l').replace('0', 'o')
        accept(typed, invited).andExpect { status { isCreated() } }
    }

    @Test
    fun `inviting a member is a conflict, accepting while already a member too`() {
        val world = fixtures.world()
        invite(world.shopId, world.owner, world.staff.phone).expectProblem(409, "membership.already_member")
        invite(world.shopId, world.owner, world.owner.phone).expectProblem(409, "membership.already_member")

        // Invited while not a member, then joined another way: the open code answers already_member.
        val joiner = fixtures.actor()
        val code = issueCode(world.shopId, world.owner, joiner.phone)
        fixtures.addStaff(world.shopId, joiner)
        accept(code, joiner).expectProblem(409, "membership.already_member")
    }

    @Test
    fun `accepting one code spends every other open code of that shop for the same phone`() {
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val joiner = fixtures.actor()
        val first = issueCode(shopId, owner, joiner.phone)
        val second = issueCode(shopId, owner, joiner.phone)
        val otherPhone = issueCode(shopId, owner, TestUsers.phone())
        val otherShopOwner = fixtures.actor()
        val otherShop = fixtures.shop(otherShopOwner)
        val otherShopCode = issueCode(otherShop, otherShopOwner, joiner.phone)

        accept(first, joiner).andExpect { status { isCreated() } }
        assertEquals(false, isOpen(second))
        assertEquals(true, isOpen(otherPhone), "invitations for other phones stay open")
        assertEquals(true, isOpen(otherShopCode), "invitations of other shops stay open")

        // Even after the membership disappears without the removal endpoint, the spent code stays dead.
        jdbc.update("DELETE FROM memberships WHERE shop_id = ? AND user_id = ?", shopId, joiner.id)
        accept(second, joiner).expectProblem(404, "not_found")
        assertNull(fixtures.roleOf(shopId, joiner.id))
    }

    @Test
    fun `a removed member cannot rejoin with a second code issued earlier`() {
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        val joiner = fixtures.actor()
        // A code still open while its phone holds a membership (here the membership came another way;
        // before the fix, the second code of a double invitation was exactly this).
        val second = issueCode(shopId, owner, joiner.phone)
        fixtures.addStaff(shopId, joiner)
        val unrelated = issueCode(shopId, owner, TestUsers.phone())

        mvc
            .delete("/v1/shops/$shopId/members/${joiner.id}") { header(AUTHORIZATION, owner.bearer) }
            .andExpect { status { isNoContent() } }
        assertEquals(false, isOpen(second))
        assertEquals(true, isOpen(unrelated), "invitations for other phones stay open")

        accept(second, joiner).expectProblem(404, "not_found")
        assertNull(fixtures.roleOf(shopId, joiner.id))

        // A fresh invitation after removal still works: removal closes old codes, it does not ban the phone.
        val fresh = issueCode(shopId, owner, joiner.phone)
        accept(fresh, joiner).andExpect { status { isCreated() } }
    }

    private fun isOpen(code: String): Boolean =
        jdbc.queryForObject(
            "SELECT accepted_at IS NULL AND expires_at > ? FROM invitations WHERE code_hash = ?",
            Boolean::class.java,
            // The application's clock decides expiry, so compare with it rather than the database clock.
            java.sql.Timestamp.from(java.time.Instant.now()),
            hasher.hash(code),
        )!!

    @Test
    fun `at most five open invitations per shop`() {
        val owner = fixtures.actor()
        val shopId = fixtures.shop(owner)
        repeat(5) { issueCode(shopId, owner, TestUsers.phone()) }
        invite(shopId, owner, TestUsers.phone()).expectProblem(409, "conflict")
        assertEquals(5, fixtures.invitationCount(shopId))

        // An expired invitation no longer counts as open.
        jdbc.update(
            "UPDATE invitations SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' " +
                "WHERE id = (SELECT id FROM invitations WHERE shop_id = ? ORDER BY id LIMIT 1)",
            shopId,
        )
        invite(shopId, owner, TestUsers.phone()).andExpect { status { isCreated() } }
    }

    @Test
    fun `accept attempts are limited to ten per ten minutes per user`() {
        val caller = fixtures.actor()
        repeat(10) { accept(unknownCode(), caller).expectProblem(404, "not_found") }
        val response = accept(unknownCode(), caller).andReturn().response
        assertEquals(429, response.status)
        assertEquals("rate_limited", JsonPath.read(response.contentAsString, "$.code"))
        val retryAfter = assertNotNull(response.getHeader("Retry-After")).toLong()
        assertTrue(retryAfter in 1..600, "Retry-After $retryAfter")

        // Another user has a bucket of their own.
        accept(unknownCode(), fixtures.actor()).expectProblem(404, "not_found")
    }

    @Test
    fun `owner lists members with masked phones and removes staff`() {
        val world = fixtures.world()
        val body =
            mvc
                .get("/v1/shops/${world.shopId}/members") { header(AUTHORIZATION, world.owner.bearer) }
                .andExpect { status { isOk() } }
                .andReturn()
                .response.contentAsString
        val members = JsonPath.read<List<Map<String, Any?>>>(body, "$.members")
        assertEquals(listOf("OWNER", "STAFF", "STAFF"), members.map { it["role"] })
        assertEquals(
            setOf(world.owner.id, world.staff.id, world.otherStaff.id).map { it.toString() }.toSet(),
            members.map { it["userId"] }.toSet(),
        )
        listOf(world.owner, world.staff, world.otherStaff).forEach { member ->
            assertFalse(body.contains(member.phone), "a full phone number is listed")
            assertTrue(body.contains(TestUsers.masked(member.phone)))
        }

        mvc
            .delete("/v1/shops/${world.shopId}/members/${world.staff.id}") { header(AUTHORIZATION, world.owner.bearer) }
            .andExpect { status { isNoContent() } }
        assertNull(fixtures.roleOf(world.shopId, world.staff.id))
        mvc
            .delete("/v1/shops/${world.shopId}/members/${world.staff.id}") { header(AUTHORIZATION, world.owner.bearer) }
            .expectProblem(404, "not_found")
    }

    @Test
    fun `the owner cannot remove their own membership and unknown members are 404`() {
        val world = fixtures.world()
        mvc
            .delete("/v1/shops/${world.shopId}/members/${world.owner.id}") { header(AUTHORIZATION, world.owner.bearer) }
            .expectProblem(409, "membership.owner_locked")
        assertEquals("OWNER", fixtures.roleOf(world.shopId, world.owner.id))
        mvc
            .delete("/v1/shops/${world.shopId}/members/${UUID.randomUUID()}") { header(AUTHORIZATION, world.owner.bearer) }
            .expectProblem(404, "not_found")
        mvc
            .delete("/v1/shops/${world.shopId}/members/${fixtures.actor().id}") { header(AUTHORIZATION, world.owner.bearer) }
            .expectProblem(404, "not_found")
    }

    @Test
    fun `invitation codes are uniformly drawn from the alphabet`() {
        val codes = List(2_000) { InvitationCode.generate() }
        codes.forEach { code ->
            assertEquals(8, code.length)
            assertTrue(code.none { it in "ILOU" })
            assertEquals(code, InvitationCode.normalize(code))
        }
        // Every one of the 32 symbols shows up in 16 000 draws.
        assertEquals(InvitationCode.ALPHABET.toSet(), codes.joinToString("").toSet())
        assertNull(InvitationCode.normalize("ABCDEFG"))
        assertNull(InvitationCode.normalize("ABCDEFG!"))
    }

    private fun unknownCode(): String = InvitationCode.generate()
}
