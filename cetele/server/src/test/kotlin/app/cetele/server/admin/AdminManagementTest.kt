package app.cetele.server.admin

import app.cetele.server.admin.AdminTestSupport.Companion.assertRedirect
import app.cetele.server.admin.web.AdminWebAdvice
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.transaction.support.TransactionTemplate
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@IntegrationTest
class AdminManagementTest : AdminIntegrationTest() {
    @Autowired lateinit var management: AdminManagementService

    @Autowired lateinit var tx: TransactionTemplate

    @Test
    fun `self disable demotion and reset return 409 without changing credentials`() {
        val (admin, session) = admins.signedIn()
        val before = accounts.findById(admin.id)!!
        val hash = before.passwordHash
        val secret = checkNotNull(before.totpSecretEnc).copyOf()
        listOf("disable", "role", "totp-reset").forEach { action ->
            val refused =
                admins.post(
                    "/admin/admins/${admin.id}/$action",
                    session,
                    admins.randomIp(),
                    "role" to "SUPPORT",
                )
            assertEquals(409, refused.response.status)
            assertTrue(refused.response.contentAsString.contains(AdminManagementService.SELF))
        }
        val after = accounts.findById(admin.id)!!
        assertTrue(after.enabled)
        assertEquals(AdminRole.ADMIN, after.role)
        assertEquals(hash, after.passwordHash)
        assertTrue(secret.contentEquals(after.totpSecretEnc))
        assertEquals(listOf("ADMIN_LOGIN_SUCCEEDED"), admins.actions(admin.id))
    }

    @Test
    fun `last enabled admin cannot be disabled or demoted and conflicts map to 409`() {
        val target = admins.admin()
        val actor = admins.admin()
        tx.executeWithoutResult { status ->
            try {
                jdbc.update(
                    "UPDATE admin_users SET disabled_at = now() WHERE role = 'ADMIN' AND id <> ?",
                    target.id,
                )
                val principal = AdminPrincipal(actor.id, actor.email, actor.role, java.time.Instant.now())
                assertEquals(1L, accounts.countEnabledAdmins())
                val disable = assertFailsWith<AdminConflictException> { management.disable(principal, target.id) }
                val demote =
                    assertFailsWith<AdminConflictException> {
                        management.changeRole(principal, target.id, AdminRole.SUPPORT)
                    }
                listOf(disable, demote).forEach { conflict ->
                    assertEquals(AdminManagementService.LAST_ADMIN, conflict.messageTr)
                    val response = MockHttpServletResponse()
                    val view = AdminWebAdvice().conflict(conflict, MockHttpServletRequest(), response)
                    assertEquals(409, response.status)
                    assertEquals(AdminManagementService.LAST_ADMIN, view.model["text"])
                }
                assertTrue(accounts.findById(target.id)!!.enabled)
                assertEquals(AdminRole.ADMIN, accounts.findById(target.id)!!.role)
                assertEquals(1L, accounts.countEnabledAdmins())
                assertTrue(admins.actions(actor.id).isEmpty())
            } finally {
                status.setRollbackOnly()
            }
        }
    }

    @Test
    fun `another admin can be demoted disabled and enabled with audited changes`() {
        val (actor, session) = admins.signedIn()
        val target = admins.admin()
        assertRedirect(
            admins.post("/admin/admins/${target.id}/role", session, admins.randomIp(), "role" to "SUPPORT").response,
            "/admin/admins",
        )
        assertEquals(AdminRole.SUPPORT, accounts.findById(target.id)!!.role)
        assertRedirect(admins.post("/admin/admins/${target.id}/disable", session, admins.randomIp()).response, "/admin/admins")
        assertFalse(accounts.findById(target.id)!!.enabled)
        assertRedirect(admins.post("/admin/admins/${target.id}/enable", session, admins.randomIp()).response, "/admin/admins")
        assertTrue(accounts.findById(target.id)!!.enabled)
        assertEquals(
            listOf("ADMIN_LOGIN_SUCCEEDED", "ADMIN_USER_ROLE_CHANGED", "ADMIN_USER_DISABLED", "ADMIN_USER_ENABLED"),
            admins.actions(actor.id),
        )
    }
}
