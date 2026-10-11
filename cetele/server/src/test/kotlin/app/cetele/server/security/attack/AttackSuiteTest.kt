package app.cetele.server.security.attack

import app.cetele.server.billing.play.FakePlayDeveloperApi
import app.cetele.server.media.MediaFixtures
import app.cetele.server.media.store.MediaStore
import app.cetele.server.tenancy.Actor
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The IDOR matrix of the attack suite (spec section 6 items 4 and 23) over real HTTP: every
 * shop-scoped endpoint is called by members of another shop, by a user without a shop, by STAFF on
 * OWNER actions, by the members of a deleted shop, and with ids of another shop in the path or in
 * the body. Every refused call must leave the target shop's rows byte-for-byte unchanged.
 */
@AttackTest
class AttackSuiteTest : AttackSupport() {
    @Autowired lateinit var store: MediaStore

    /** A shop with an owner, two staff members, a customer with a debt and a ready photo. */
    private inner class Target {
        private val media = MediaFixtures(mvc, auth, jdbc, store)
        val shopId: UUID = media.shopId
        val owner: Actor = media.owner
        val staff: Actor = tenancy.addStaff(shopId)
        val otherStaff: Actor = tenancy.addStaff(shopId)
        val customer: UUID = ledger.customer(shopId, smsConsent = true)
        val entry: UUID = ledger.entry(shopId, customer)
        val mediaId: UUID = media.ready()
    }

    private data class Call(
        val name: String,
        val method: String,
        val path: String,
        val body: String? = null,
        val ownerOnly: Boolean = false,
    )

    private fun calls(
        shopId: UUID,
        member: UUID,
        customer: UUID,
        mediaId: UUID,
    ): List<Call> {
        val s = "/v1/shops/$shopId"
        val invitee = tenancy.actor().phone
        return listOf(
            Call("GET shop", "GET", s),
            Call("PATCH shop", "PATCH", s, """{"name":"Ele geçirildi"}""", ownerOnly = true),
            Call("DELETE shop", "DELETE", s, """{"code":"123456"}""", ownerOnly = true),
            Call("DELETE shop deletion", "DELETE", "$s/deletion", ownerOnly = true),
            Call("POST ownership-transfer", "POST", "$s/ownership-transfer", """{"userId":"$member","code":"123456"}""", ownerOnly = true),
            Call("GET members", "GET", "$s/members", ownerOnly = true),
            Call("DELETE member", "DELETE", "$s/members/$member", ownerOnly = true),
            Call("POST invitations", "POST", "$s/invitations", """{"phone":"$invitee"}""", ownerOnly = true),
            Call("POST sync push", "POST", "$s/sync/push", pushBody(customerUpsert(UUID.randomUUID(), "Saldırgan"))),
            Call("GET sync pull", "GET", "$s/sync/pull?since=0&limit=500"),
            Call("POST statement-links", "POST", "$s/statement-links", """{"customerId":"$customer"}"""),
            Call("GET statement.pdf", "GET", "$s/customers/$customer/statement.pdf"),
            Call("POST media presign", "POST", "$s/media/presign", """{"contentType":"image/jpeg","contentLength":1000}"""),
            Call("POST media complete", "POST", "$s/media/$mediaId/complete"),
            Call("GET media", "GET", "$s/media/$mediaId"),
            Call("POST reminders", "POST", "$s/reminders", """{"customerId":"$customer","channel":"SMS","template":"BALANCE"}"""),
            Call("GET billing", "GET", "$s/billing"),
            Call(
                "POST billing link",
                "POST",
                "$s/billing/link",
                """{"productId":"cetele_pro","purchaseToken":"${FakePlayDeveloperApi.token("active", shopId, "idor")}"}""",
                ownerOnly = true,
            ),
        )
    }

    private fun calls(target: Target) = calls(target.shopId, target.staff.id, target.customer, target.mediaId)

    private fun send(
        endpoint: Call,
        actor: Actor,
    ): RawHttp.Response = call(endpoint.method, endpoint.path, actor.bearer, endpoint.body)

    /** Every row of every tenant table that belongs to [shopId]. */
    private fun snapshot(shopId: UUID): Map<String, List<Map<String, Any?>>> =
        TENANT_TABLES.associateWith { table ->
            val column = if (table == "shops") "id" else "shop_id"
            jdbc.queryForList("SELECT * FROM $table WHERE $column = ? ORDER BY 1", shopId).map { row ->
                row.mapValues { it.value?.toString() }
            }
        }

    @Test
    fun `members of another shop and users without a shop get the not found answer on every shop endpoint`() {
        val attacker = Target()
        val victim = Target()
        val loner = tenancy.actor()
        val before = snapshot(victim.shopId)
        val unknown = calls(UUID.randomUUID(), victim.staff.id, victim.customer, victim.mediaId)
        mapOf("owner of A" to attacker.owner, "staff of A" to attacker.staff, "user without a shop" to loner).forEach { (who, actor) ->
            calls(victim).zip(unknown).forEach { (foreign, missing) ->
                val response = send(foreign, actor)
                assertProblem(response, 404, "not_found", "$who on ${foreign.name}")
                val baseline = send(missing, actor)
                assertEquals(shape(baseline), shape(response), "$who on ${foreign.name}: foreign shop differs from a missing shop")
            }
        }
        assertEquals(before, snapshot(victim.shopId))
    }

    @Test
    fun `staff gets forbidden on every owner action and the shop stays unchanged`() {
        val target = Target()
        val before = snapshot(target.shopId)
        calls(target.shopId, target.otherStaff.id, target.customer, target.mediaId).filter { it.ownerOnly }.forEach { endpoint ->
            assertProblem(send(endpoint, target.staff), 403, "forbidden", "staff on ${endpoint.name}")
        }
        // Customer deletion is an owner action inside a sync batch: the operation is rejected, not applied.
        val response =
            call(
                "POST",
                "/v1/shops/${target.shopId}/sync/push",
                target.staff.bearer,
                pushBody(operation(1, "CUSTOMER_DELETE", """"customerId":"${target.customer}"""")),
            )
        assertEquals(200, response.status, response.toString())
        assertEquals(listOf("forbidden"), JsonPath.read<List<String>>(response.text, "$.results[*].code"))
        assertEquals(before, snapshot(target.shopId))
    }

    @Test
    fun `members of a deleted shop get not found on every endpoint`() {
        val target = Target()
        jdbc.update("UPDATE shops SET deleted_at = now() WHERE id = ?", target.shopId)
        val before = snapshot(target.shopId)
        listOf("owner" to target.owner, "staff" to target.staff).forEach { (who, actor) ->
            calls(target).forEach { endpoint ->
                assertProblem(send(endpoint, actor), 404, "not_found", "$who of a deleted shop on ${endpoint.name}")
            }
        }
        assertEquals(before, snapshot(target.shopId))
    }

    @Test
    fun `ids of another shop in the path of the caller's own shop are not found`() {
        val attacker = Target()
        val victim = Target()
        val before = snapshot(victim.shopId)
        val own = "/v1/shops/${attacker.shopId}"
        val owner = attacker.owner.bearer
        assertProblem(call("GET", "$own/customers/${victim.customer}/statement.pdf", owner), 404, "not_found", "pdf of a foreign customer")
        assertProblem(call("POST", "$own/media/${victim.mediaId}/complete", owner), 404, "not_found", "complete a foreign photo")
        assertProblem(call("GET", "$own/media/${victim.mediaId}", owner), 404, "not_found", "download a foreign photo")
        assertProblem(call("DELETE", "$own/members/${victim.staff.id}", owner), 404, "not_found", "remove a foreign member")
        assertEquals(before, snapshot(victim.shopId))
    }

    @Test
    fun `ids of another shop in request bodies are refused`() {
        val attacker = Target()
        val victim = Target()
        val before = snapshot(victim.shopId)
        val own = "/v1/shops/${attacker.shopId}"
        val owner = attacker.owner.bearer
        assertProblem(
            call("POST", "$own/statement-links", owner, """{"customerId":"${victim.customer}"}"""),
            404,
            "not_found",
            "statement link for a foreign customer",
        )
        assertProblem(
            call("POST", "$own/reminders", owner, """{"customerId":"${victim.customer}","channel":"SMS","template":"BALANCE"}"""),
            404,
            "not_found",
            "reminder to a foreign customer",
        )
        // The shop is never taken from the body: an extra shopId member is an unknown property.
        val smuggled = """{"shopId":"${victim.shopId}","operations":[]}"""
        assertProblem(call("POST", "$own/sync/push", owner, smuggled), 422, "validation.failed", "shopId in a sync body")

        val ownCustomer = ledger.customer(attacker.shopId)
        val ops =
            listOf(
                customerUpsert(victim.customer, "Ele geçirildi", seq = 1),
                operation(2, "CUSTOMER_DELETE", """"customerId":"${victim.customer}""""),
                entryCreate(3, UUID.randomUUID(), victim.customer),
                entryCreate(4, victim.entry, ownCustomer),
                entryCreate(5, UUID.randomUUID(), ownCustomer, extra = ""","reverses":"${victim.entry}""""),
                entryCreate(6, UUID.randomUUID(), ownCustomer, extra = ""","photoKey":"media/${victim.shopId}/${victim.mediaId}.jpg""""),
            )
        // Finding F-06: a foreign id answers conflict where an unknown id answers not_found (UUIDv7 ids keep this unguessable).
        val response = call("POST", "$own/sync/push", owner, pushBody(*ops.toTypedArray()))
        assertEquals(200, response.status, response.toString())
        assertEquals(
            listOf("conflict", "not_found", "conflict", "conflict", "ledger.reversal_mismatch", "validation.failed"),
            JsonPath.read<List<String>>(response.text, "$.results[*].code"),
        )
        assertEquals(List(ops.size) { "REJECTED" }, JsonPath.read<List<String>>(response.text, "$.results[*].status"))
        assertEquals(before, snapshot(victim.shopId))
        assertNull(jdbc.queryForList("SELECT reversed_by FROM ledger_entries WHERE id = ?", victim.entry).single()["reversed_by"])
    }

    @Test
    fun `tenant endpoints without a token are 401 and never 404`() {
        val target = Target()
        calls(target).forEach { endpoint ->
            val response = call(endpoint.method, endpoint.path, bearer = null, json = endpoint.body)
            assertProblem(response, 401, "auth.unauthenticated", "anonymous ${endpoint.name}")
        }
    }

    private fun operation(
        seq: Long,
        kind: String,
        payload: String,
    ) = """{"clientId":"${UUID.randomUUID()}","clientSeq":$seq,"kind":"$kind",$payload}"""

    private fun customerUpsert(
        id: UUID,
        name: String,
        seq: Long = 1,
    ) = operation(seq, "CUSTOMER_UPSERT", """"customer":{"id":"$id","name":"$name","smsConsent":false}""")

    private fun entryCreate(
        seq: Long,
        id: UUID,
        customer: UUID,
        extra: String = "",
    ) = operation(
        seq,
        "ENTRY_CREATE",
        """"entry":{"id":"$id","customerId":"$customer","type":"DEBT","amountMinor":12500,"occurredOn":"2026-10-01"$extra}""",
    )

    private fun pushBody(vararg operations: String) = """{"operations":[${operations.joinToString(",")}]}"""

    companion object {
        private val TENANT_TABLES =
            listOf(
                "shops",
                "memberships",
                "invitations",
                "customers",
                "ledger_entries",
                "shop_sequences",
                "change_log",
                "sync_outbox_receipts",
                "statement_links",
                "reminders",
                "sms_quota",
                "media_objects",
                "deletion_requests",
                "subscriptions",
            )
    }
}
