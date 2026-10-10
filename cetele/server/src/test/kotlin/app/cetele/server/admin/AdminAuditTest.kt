package app.cetele.server.admin

import app.cetele.server.admin.audit.AuditAction
import app.cetele.server.admin.audit.AuditActorType
import app.cetele.server.admin.audit.AuditIpHasher
import app.cetele.server.admin.audit.AuditLogService
import app.cetele.server.admin.audit.AuditRetentionJob
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.support.IntegrationTest
import app.cetele.server.tenancy.TenancyFixtures
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.mock.web.MockHttpSession
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get
import org.springframework.transaction.IllegalTransactionStateException
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.ObjectMapper
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@IntegrationTest
class AdminAuditTest : AdminIntegrationTest() {
    @Autowired lateinit var audit: AuditLogService

    @Autowired lateinit var ipHasher: AuditIpHasher

    @Autowired lateinit var retention: AuditRetentionJob

    @Autowired lateinit var tx: TransactionTemplate

    @Autowired lateinit var mapper: ObjectMapper

    private data class Expected(
        val action: AuditAction,
        val targetType: String?,
        val targetId: UUID?,
        val metadata: Map<String, Any?>,
    )

    @Test
    fun `one row per action of the table with no pii in metadata`() {
        val fixtures = TenancyFixtures(mvc, auth, jdbc)
        val owner = fixtures.actor()
        val shopName = "[ÖRNEK] Denetim Bakkalı " + UUID.randomUUID().toString().take(6)
        val shopId = fixtures.shop(owner, shopName)
        val deviceRowId = TraceIdFilter.uuidV7()
        val deviceId = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO devices (id, user_id, device_id, model, app_version, last_seen_at) VALUES (?, ?, ?, 'Pixel 8', '1.4.0', now())",
            deviceRowId,
            owner.id,
            deviceId,
        )
        insertRefreshToken(owner.id, deviceId)
        insertRefreshToken(owner.id, deviceId)
        val target = admins.admin(AdminRole.SUPPORT)

        val admin = admins.admin(AdminRole.ADMIN)
        val ip = admins.randomIp()
        val session = admins.signIn(admin, ip)
        val traces = mutableListOf<String>()

        fun get(
            path: String,
            vararg params: Pair<String, String>,
        ): MvcResult =
            mvc
                .get(path) {
                    this.session = session
                    with(
                        org.springframework.test.web.servlet.request.RequestPostProcessor {
                            it.apply { remoteAddr = ip }
                        },
                    )
                    params.forEach { (k, v) -> param(k, v) }
                }.andReturn()
                .also { traces += it.response.getHeader(TraceIdFilter.HEADER)!! }

        fun post(
            path: String,
            vararg params: Pair<String, String>,
        ): MvcResult = admins.post(path, session, ip, *params).also { traces += it.response.getHeader(TraceIdFilter.HEADER)!! }

        get("/admin")
        get("/admin/shops", "q" to "Denetim")
        get("/admin/shops/$shopId")
        get("/admin/users", "phone" to owner.phone)
        get("/admin/users/${owner.id}")
        post("/admin/users/${owner.id}/devices/$deviceRowId/revoke")
        insertRefreshToken(owner.id, deviceId)
        post("/admin/users/${owner.id}/deactivate")
        post("/admin/users/${owner.id}/reactivate")
        val newEmail = "yeni-" + UUID.randomUUID().toString().take(8) + "@cetele.test"
        val created = post("/admin/admins/new", "email" to newEmail, "role" to "SUPPORT")
        val oneTime = Regex("class=\"secret\">([^<]+)<").find(created.response.contentAsString)!!.groupValues[1]
        val newId = accounts.findByEmail(newEmail)!!.id
        post("/admin/admins/${target.id}/role", "role" to "ADMIN")
        post("/admin/admins/${target.id}/disable")
        post("/admin/admins/${target.id}/enable")
        post("/admin/admins/${target.id}/totp-reset")
        val newPassword = "[ÖRNEK] değişen parola"
        post("/admin/account/password", "currentPassword" to admin.password, "newPassword" to newPassword, "confirmPassword" to newPassword)
        get("/admin/audit", "page" to "0")
        post("/admin/logout")

        val expected =
            listOf(
                Expected(AuditAction.ADMIN_LOGIN_SUCCEEDED, null, null, emptyMap()),
                Expected(AuditAction.SHOP_SEARCHED, null, null, mapOf("results" to 1)),
                Expected(AuditAction.SHOP_VIEWED, "SHOP", shopId, emptyMap()),
                Expected(AuditAction.USER_SEARCHED, null, null, mapOf("results" to 1)),
                Expected(AuditAction.USER_VIEWED, "USER", owner.id, emptyMap()),
                Expected(AuditAction.DEVICE_REVOKED, "DEVICE", deviceRowId, mapOf("revokedSessions" to 2)),
                Expected(AuditAction.USER_DEACTIVATED, "USER", owner.id, mapOf("revokedSessions" to 1)),
                Expected(AuditAction.USER_REACTIVATED, "USER", owner.id, emptyMap()),
                Expected(AuditAction.ADMIN_USER_CREATED, "ADMIN_USER", newId, mapOf("role" to "SUPPORT")),
                Expected(AuditAction.ADMIN_USER_ROLE_CHANGED, "ADMIN_USER", target.id, mapOf("from" to "SUPPORT", "to" to "ADMIN")),
                Expected(AuditAction.ADMIN_USER_DISABLED, "ADMIN_USER", target.id, emptyMap()),
                Expected(AuditAction.ADMIN_USER_ENABLED, "ADMIN_USER", target.id, emptyMap()),
                Expected(AuditAction.ADMIN_TOTP_RESET, "ADMIN_USER", target.id, emptyMap()),
                Expected(AuditAction.ADMIN_PASSWORD_CHANGED, "ADMIN_USER", admin.id, mapOf("forced" to false)),
                Expected(AuditAction.AUDIT_LOG_VIEWED, null, null, mapOf("page" to 0)),
                Expected(AuditAction.ADMIN_LOGGED_OUT, null, null, emptyMap()),
            )
        val rows = admins.auditRows(admin.id)
        assertEquals(expected.map { it.action.name }, rows.map { it["action"] })
        expected.zip(rows).forEach { (want, row) ->
            assertEquals("ADMIN", row["actor_type"])
            assertEquals(want.targetType, row["target_type"], "${want.action} target type")
            assertEquals(want.targetId, row["target_id"], "${want.action} target id")
            @Suppress("UNCHECKED_CAST")
            val metadata = mapper.readValue(row["metadata"] as String, Map::class.java) as Map<String, Any?>
            assertEquals(want.metadata, metadata, "${want.action} metadata")
            assertTrue(metadata.keys.all { it in want.action.metadataKeys })
            assertEquals(ipHasher.hash(ip), row["ip_hash"], "${want.action} ip hash")
            assertNotNull(row["trace_id"])
        }
        // Each row carries the trace id of the request that wrote it; the dashboard (aggregates only) writes none.
        assertEquals(traces.drop(1), rows.drop(1).map { it["trace_id"].toString() })

        val everything = rows.joinToString(" ") { it["metadata"].toString() }
        listOf(
            owner.phone,
            owner.phone.takeLast(10),
            admin.email,
            newEmail,
            target.email,
            shopName,
            "Denetim",
            newPassword,
            oneTime,
            admin.password,
        ).forEach { assertFalse(everything.contains(it), "metadata leaks a personal value") }
        assertNull(rows.firstOrNull { it["ip_hash"].toString().contains(ip) })
    }

    @Test
    fun `audit rows are written only inside the action's transaction`() {
        assertFailsWith<IllegalTransactionStateException> {
            audit.record(AuditActorType.SYSTEM, null, AuditAction.SHOP_VIEWED)
        }
        tx.executeWithoutResult {
            assertFailsWith<IllegalArgumentException> {
                audit.record(AuditActorType.ADMIN, UUID.randomUUID(), AuditAction.USER_SEARCHED, metadata = mapOf("phone" to 1))
            }
            assertFailsWith<IllegalArgumentException> {
                audit.record(
                    AuditActorType.ADMIN,
                    UUID.randomUUID(),
                    AuditAction.ADMIN_USER_CREATED,
                    metadata =
                        mapOf("role" to "yonetici@cetele.test"),
                )
            }
            it.setRollbackOnly()
        }
    }

    @Test
    fun `retention removes rows older than 365 days only`() {
        val actor = UUID.randomUUID()
        tx.executeWithoutResult {
            audit.record(AuditActorType.ADMIN, actor, AuditAction.ADMIN_LOGGED_OUT)
            audit.record(AuditActorType.ADMIN, actor, AuditAction.ADMIN_LOGIN_SUCCEEDED)
        }
        jdbc.update(
            "UPDATE audit_logs SET at = ? WHERE actor_id = ? AND action = 'ADMIN_LOGGED_OUT'",
            Timestamp.from(Instant.now().minus(Duration.ofDays(366))),
            actor,
        )
        assertTrue(retention.run(Instant.now()) >= 1)
        assertEquals(listOf("ADMIN_LOGIN_SUCCEEDED"), admins.actions(actor))
    }

    @Test
    fun `the audit page shows the log to admins only and records the page`() {
        val (admin, session) = admins.signedIn(AdminRole.ADMIN)
        val result = page("/admin/audit?page=0", session)
        assertEquals(200, result.response.status)
        assertTrue(result.response.contentAsString.contains("ADMIN_LOGIN_SUCCEEDED"))
        val (support, supportSession) = admins.signedIn(AdminRole.SUPPORT)
        assertEquals(403, page("/admin/audit", supportSession).response.status)
        assertEquals(listOf("ADMIN_LOGIN_SUCCEEDED"), admins.actions(support.id))
        assertEquals(listOf("ADMIN_LOGIN_SUCCEEDED", "AUDIT_LOG_VIEWED"), admins.actions(admin.id))
        assertEquals(302, page("/admin/audit", MockHttpSession()).response.status)
    }

    private fun insertRefreshToken(
        userId: UUID,
        deviceId: UUID,
    ) {
        val bytes = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        jdbc.update(
            "INSERT INTO refresh_tokens (id, token_hash, user_id, device_id, family_id, expires_at, family_expires_at) VALUES (?, ?, ?, ?, ?, now() + interval '30 days', now() + interval '90 days')",
            TraceIdFilter.uuidV7(),
            bytes,
            userId,
            deviceId,
            UUID.randomUUID(),
        )
    }
}
