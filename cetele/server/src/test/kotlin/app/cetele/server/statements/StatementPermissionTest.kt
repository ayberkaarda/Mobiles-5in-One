package app.cetele.server.statements

import app.cetele.server.security.Permission
import app.cetele.server.security.PermissionMatrix
import app.cetele.server.security.ShopRole
import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

@IntegrationTest
class StatementPermissionTest : StatementTestSupport() {
    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    lateinit var mappings: RequestMappingHandlerMapping

    @Test
    fun `permission table covers handlers and handlers cover the table`() {
        val actual =
            mappings.handlerMethods
                .filter { (_, handler) ->
                    handler.beanType.packageName.startsWith("app.cetele.server.statements.web")
                }.map { (info, handler) ->
                    val expression = assertNotNull(handler.getMethodAnnotation(PreAuthorize::class.java)).value
                    val codes = Regex("'([A-Z_]+)'").findAll(expression).map { it.groupValues[1] }.toSet()
                    assertEquals(codes.size, expression.split("@perm.can").size - 1)
                    if (codes.isEmpty()) assertEquals("permitAll()", expression)
                    val method =
                        info.methodsCondition.methods
                            .single()
                            .name
                    val pattern = assertNotNull(info.pathPatternsCondition).patternValues.single()
                    "$method $pattern" to codes
                }.toMap()
        assertEquals(endpoints, actual)
    }

    @Test
    fun `all endpoints follow permissions for owner staff and non member`() {
        for (role in listOf("OWNER", "STAFF", "NON_MEMBER")) {
            val w = world()
            val c = ledger().customer(w.shopId)
            val bearer =
                when (role) {
                    "OWNER" -> w.owner.bearer
                    "STAFF" -> w.staff.bearer
                    else -> auth.bearer(auth.user())
                }
            for ((endpoint, codes) in endpoints) {
                if (codes.isEmpty()) {
                    val link = links.issue(w.shopId, c, w.owner.id, now = clock.instant())
                    assertEquals(200, open(link.token).status)
                } else {
                    val allowed =
                        role != "NON_MEMBER" && codes.all { PermissionMatrix.isAllowed(ShopRole.valueOf(role), Permission.fromCode(it)!!) }
                    val success = if (endpoint.startsWith("POST")) 201 else 200
                    val response = if (endpoint.startsWith("POST")) issue(w, c, bearer) else pdf(w, c, bearer)
                    assertEquals(
                        if (role == "NON_MEMBER") {
                            404
                        } else if (allowed) {
                            success
                        } else {
                            403
                        },
                        response.status,
                    )
                }
            }
        }
    }

    companion object {
        val endpoints =
            mapOf(
                "POST /v1/shops/{shopId}/statement-links" to setOf("STATEMENT_LINK_CREATE"),
                "GET /v1/shops/{shopId}/customers/{customerId}/statement.pdf" to setOf("LEDGER_READ", "CUSTOMER_READ"),
                "GET /s/{token}" to emptySet(),
            )
    }
}
