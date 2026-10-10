package app.cetele.server.billing

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
import kotlin.test.assertNull

@IntegrationTest
class BillingPermissionTest : BillingTestSupport() {
    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    lateinit var mappings: RequestMappingHandlerMapping

    private val endpoints =
        mapOf(
            "GET /v1/shops/{shopId}/billing" to "SHOP_READ",
            "POST /v1/shops/{shopId}/billing/link" to "BILLING_MANAGE",
        )

    @Test
    fun `permission table and handler annotations cover each other`() {
        val annotated =
            mappings.handlerMethods
                .filter { it.value.beanType.packageName == "app.cetele.server.billing.web" }
                .map { (mapping, handler) ->
                    val expression = assertNotNull(handler.getMethodAnnotation(PreAuthorize::class.java)).value
                    val code = Regex("'([A-Z_]+)'").find(expression)!!.groupValues[1]
                    assertEquals("@perm.can(#shopId, '$code')", expression)
                    "${mapping.methodsCondition.methods.single().name} ${mapping.pathPatternsCondition!!.patternValues.single()}" to code
                }.toMap()
        assertEquals(endpoints, annotated)
        // The webhook authenticates the push itself and is not a tenant endpoint.
        val webhook =
            mappings.handlerMethods.entries.single {
                it.value.beanType.packageName == "app.cetele.server.billing.webhook"
            }
        assertNull(webhook.value.getMethodAnnotation(PreAuthorize::class.java))
        assertEquals(setOf("/v1/webhooks/play-rtdn"), webhook.key.pathPatternsCondition!!.patternValues)
    }

    @Test
    fun `only the owner may manage billing and both roles read it`() {
        assertEquals(true, PermissionMatrix.isAllowed(ShopRole.OWNER, Permission.BillingManage))
        assertEquals(false, PermissionMatrix.isAllowed(ShopRole.STAFF, Permission.BillingManage))
        val world = world()
        listOf(world.owner, world.staff).forEach { billing(world.shopId, it).andExpect { status { isOk() } } }
        linkOk(world.shopId, token("pending", world.shopId), world.owner)
        val staffBody = billing(world.shopId, world.staff).andReturn().response.contentAsString
        assertEquals(false, staffBody.contains("purchaseToken"))
        assertEquals(false, staffBody.contains("purchase_token"))
    }
}
