package app.cetele.server.reminders

import app.cetele.server.security.Permission
import app.cetele.server.security.PermissionMatrix
import app.cetele.server.security.ShopRole
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.test.web.servlet.MockMvc
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

@IntegrationTest
class ReminderPermissionTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired @Qualifier("requestMappingHandlerMapping") private val mappings: RequestMappingHandlerMapping,
) {
    private val endpoints = mapOf("POST /v1/shops/{shopId}/reminders" to setOf("REMINDER_SEND"))

    @Test
    fun `permission table and handler annotations cover each other`() {
        val annotated =
            mappings.handlerMethods
                .filter { it.value.beanType.packageName == "app.cetele.server.reminders.web" }
                .map { (mapping, handler) ->
                    val expression = assertNotNull(handler.getMethodAnnotation(PreAuthorize::class.java)).value
                    val codes = Regex("'([A-Z_]+)'").findAll(expression).map { it.groupValues[1] }.toSet()
                    assertEquals("@perm.can(#shopId, '${codes.single()}')", expression)
                    "${mapping.methodsCondition.methods.single().name} ${mapping.pathPatternsCondition!!.patternValues.single()}" to codes
                }.toMap()
        assertEquals(endpoints, annotated)
    }

    @Test
    fun `owner staff and nonmember outcomes follow the matrix`() {
        ShopRole.entries.filter { it == ShopRole.OWNER || it == ShopRole.STAFF }.forEach { role ->
            val f = ReminderFixtures(mvc, auth, jdbc)
            val actor = if (role == ShopRole.OWNER) f.owner else f.tenancy.addStaff(f.shopId)
            val response = f.send(f.customer(), actor)
            if (PermissionMatrix.isAllowed(role, Permission.ReminderSend)) {
                response.andExpect { status { isCreated() } }
                assertEquals(
                    actor.id,
                    jdbc.queryForObject("SELECT requested_by FROM reminders WHERE shop_id = ?", java.util.UUID::class.java, f.shopId),
                )
            } else {
                response.expectProblem(403, "forbidden")
            }
        }
        val f = ReminderFixtures(mvc, auth, jdbc)
        val customer = f.customer()
        val other = ReminderFixtures(mvc, auth, jdbc)
        listOf(other.owner, other.tenancy.addStaff(other.shopId), f.tenancy.actor()).forEach { actor ->
            f.send(customer, actor).expectProblem(404, "not_found")
        }
        assertEquals(0, f.count("reminders"))
        assertEquals(0, f.count("sms_quota"))
    }

    @Test
    fun `thirty first request hits user rate limit before sending`() {
        val f = ReminderFixtures(mvc, auth, jdbc)
        val noConsent = f.ledger.customer(f.shopId)
        repeat(30) { f.send(noConsent).expectProblem(409, "sms.consent_missing") }
        val response = f.send(noConsent)
        response.expectProblem(429, "rate_limited")
        kotlin.test.assertTrue(
            response
                .andReturn()
                .response
                .getHeader("Retry-After")!!
                .toLong() > 0,
        )
        assertEquals(0, f.count("reminders"))
    }
}
