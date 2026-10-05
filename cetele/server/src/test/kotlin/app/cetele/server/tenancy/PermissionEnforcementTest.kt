package app.cetele.server.tenancy

import app.cetele.server.security.Permission
import app.cetele.server.security.PermissionMatrix
import app.cetele.server.security.ShopRole
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.support.TestUsers
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Spec section 6 item 3, enforced end to end: every Phase 1 shop endpoint x every shop role, with
 * the expected outcome taken from [PermissionMatrix] (allowed → the endpoint's success status,
 * denied → 403 `forbidden`, no membership → 404 `not_found`). A second test ties the table to the
 * `@PreAuthorize` annotations, so an endpoint cannot be added or re-labelled without updating it.
 */
@IntegrationTest
class PermissionEnforcementTest(
    @Autowired private val mvc: MockMvc,
    @Autowired auth: TestAuth,
    @Autowired jdbc: JdbcTemplate,
    @Autowired @Qualifier("requestMappingHandlerMapping") private val mappings: RequestMappingHandlerMapping,
) {
    private val fixtures = TenancyFixtures(mvc, auth, jdbc)

    /** One shop-scoped endpoint: its permission, the call and the status of a permitted call. */
    class Endpoint(
        val name: String,
        val pattern: String,
        val permission: Permission,
        val successStatus: Int,
        val call: (mvc: MockMvc, world: ShopWorld, bearer: String) -> ResultActionsDsl,
    ) {
        override fun toString(): String = name
    }

    enum class Caller { OWNER, STAFF, NON_MEMBER }

    @ParameterizedTest(name = "{0} as {1}")
    @MethodSource("cases")
    fun `each endpoint answers each role as the matrix says`(
        endpoint: Endpoint,
        caller: Caller,
    ) {
        val world = fixtures.world()
        val bearer =
            when (caller) {
                Caller.OWNER -> world.owner.bearer
                Caller.STAFF -> world.staff.bearer
                Caller.NON_MEMBER -> fixtures.actor().bearer
            }
        val result = endpoint.call(mvc, world, bearer)
        when {
            caller == Caller.NON_MEMBER -> {
                result.expectProblem(404, "not_found")
            }

            PermissionMatrix.isAllowed(ShopRole.valueOf(caller.name), endpoint.permission) -> {
                assertEquals(endpoint.successStatus, result.andReturn().response.status, result.andReturn().response.contentAsString)
            }

            else -> {
                result.expectProblem(403, "forbidden")
            }
        }
    }

    @Test
    fun `the table covers every shop endpoint with the permission its annotation names`() {
        val annotated =
            mappings.handlerMethods
                .filter { (_, handler) -> handler.beanType.packageName.startsWith("app.cetele.server.tenancy.web") }
                .mapNotNull { (info, handler) ->
                    val expression = assertNotNull(handler.getMethodAnnotation(PreAuthorize::class.java), "$info").value
                    PERM_EXPRESSION.matchEntire(expression)?.let { match ->
                        val method =
                            info.methodsCondition.methods
                                .single()
                                .name
                        val pattern = info.pathPatternsCondition!!.patternValues.single()
                        "$method $pattern" to match.groupValues[1]
                    } ?: run {
                        assertEquals("isAuthenticated()", expression, "$info")
                        null
                    }
                }.toMap()
        val table = endpoints.associate { it.pattern to it.permission.code }
        assertEquals(annotated, table)
    }

    @Test
    fun `staff are denied exactly the owner-only shop actions`() {
        val staffDenied = endpoints.filter { !PermissionMatrix.isAllowed(ShopRole.STAFF, it.permission) }.map { it.permission }.toSet()
        assertEquals(setOf(Permission.ShopManage, Permission.MembersManage), staffDenied)
        assertTrue(endpoints.any { PermissionMatrix.isAllowed(ShopRole.STAFF, it.permission) })
    }

    companion object {
        private val PERM_EXPRESSION = Regex("""@perm\.can\(#shopId, '([A-Z_]+)'\)""")

        val endpoints: List<Endpoint> =
            listOf(
                Endpoint("GET shops/{id}", "GET /v1/shops/{shopId}", Permission.ShopRead, 200) { mvc, world, bearer ->
                    mvc.get("/v1/shops/${world.shopId}") { header(AUTHORIZATION, bearer) }
                },
                Endpoint("PATCH shops/{id}", "PATCH /v1/shops/{shopId}", Permission.ShopManage, 200) { mvc, world, bearer ->
                    mvc.patch("/v1/shops/${world.shopId}") {
                        header(AUTHORIZATION, bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content = """{"name":"Yeni Ad"}"""
                    }
                },
                Endpoint("POST shops/{id}/invitations", "POST /v1/shops/{shopId}/invitations", Permission.MembersManage, 201) {
                    mvc,
                    world,
                    bearer,
                    ->
                    mvc.post("/v1/shops/${world.shopId}/invitations") {
                        header(AUTHORIZATION, bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content = """{"phone":"${TestUsers.phone()}"}"""
                    }
                },
                Endpoint("GET shops/{id}/members", "GET /v1/shops/{shopId}/members", Permission.MembersManage, 200) { mvc, world, bearer ->
                    mvc.get("/v1/shops/${world.shopId}/members") { header(AUTHORIZATION, bearer) }
                },
                Endpoint(
                    "DELETE shops/{id}/members/{userId}",
                    "DELETE /v1/shops/{shopId}/members/{userId}",
                    Permission.MembersManage,
                    204,
                ) { mvc, world, bearer ->
                    mvc.delete("/v1/shops/${world.shopId}/members/${world.otherStaff.id}") { header(AUTHORIZATION, bearer) }
                },
            )

        @JvmStatic
        fun cases(): List<Arguments> = endpoints.flatMap { endpoint -> Caller.entries.map { Arguments.of(endpoint, it) } }
    }
}
