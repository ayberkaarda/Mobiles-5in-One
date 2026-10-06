package app.cetele.server.sync

import app.cetele.server.security.Permission
import app.cetele.server.security.PermissionMatrix
import app.cetele.server.security.ShopRole
import app.cetele.server.support.IntegrationTest
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

@IntegrationTest
class SyncPermissionTest : SyncTestSupport() {
    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    lateinit var mappings: RequestMappingHandlerMapping

    enum class Caller { OWNER, STAFF, NON_MEMBER }

    @ParameterizedTest(name = "{0} as {1}")
    @MethodSource("cases")
    fun `endpoint permissions follow the matrix for every caller`(
        endpoint: String,
        caller: Caller,
    ) {
        val world = world()
        val bearer =
            when (caller) {
                Caller.OWNER -> world.owner.bearer
                Caller.STAFF -> world.staff.bearer
                Caller.NON_MEMBER -> auth.bearer(auth.user())
            }
        val response =
            if (endpoint == "POST /v1/shops/{shopId}/sync/push") {
                mvc
                    .post("/v1/shops/${world.shopId}/sync/push") {
                        header(AUTHORIZATION, bearer)
                        contentType = MediaType.APPLICATION_JSON
                        content = mapper.writeValueAsString(PushRequest(emptyList()))
                    }.andReturn()
                    .response
            } else {
                mvc.get("/v1/shops/${world.shopId}/sync/pull") { header(AUTHORIZATION, bearer) }.andReturn().response
            }
        val expected =
            when {
                caller == Caller.NON_MEMBER -> 404

                endpoints
                    .getValue(
                        endpoint,
                    ).all { PermissionMatrix.isAllowed(ShopRole.valueOf(caller.name), Permission.fromCode(it)!!) } -> 200

                else -> 403
            }
        assertEquals(expected, response.status, response.contentAsString)
        if (expected !=
            200
        ) {
            assertEquals(if (expected == 404) "not_found" else "forbidden", JsonPath.read(response.contentAsString, "$.code"))
        }
    }

    @Test
    fun `permission table and handler annotations cover each other exactly`() {
        val actual =
            mappings.handlerMethods
                .filter { (_, handler) -> handler.beanType.packageName.startsWith("app.cetele.server.sync.web") }
                .map { (info, handler) ->
                    val expression = assertNotNull(handler.getMethodAnnotation(PreAuthorize::class.java)).value
                    val codes = Regex("'([A-Z_]+)'").findAll(expression).map { it.groupValues[1] }.toSet()
                    assertEquals(codes.size, expression.split("@perm.can").size - 1)
                    val method =
                        info.methodsCondition.methods
                            .single()
                            .name
                    val path = assertNotNull(info.pathPatternsCondition).patternValues.single()
                    "$method $path" to codes
                }.toMap()
        assertEquals(endpoints, actual)
    }

    @Test
    fun `operation permissions reject only forbidden actions`() {
        ShopRole.entries.forEach { role ->
            val world = world()
            val bearer = if (role == ShopRole.OWNER) world.owner.bearer else world.staff.bearer
            val c = ledger().customer(world.shopId)
            val operations = listOf(customer(1), entry(2, c), delete(3, c))
            val permissions = listOf(Permission.CustomerWrite, Permission.LedgerWrite, Permission.CustomerDelete)
            val result = push(world, operations, bearer)
            permissions.zip(result.results).forEach { (permission, row) ->
                assertEquals(
                    if (PermissionMatrix.isAllowed(role, permission)) OperationStatus.APPLIED else OperationStatus.REJECTED,
                    row.status,
                )
                assertEquals(if (PermissionMatrix.isAllowed(role, permission)) null else "forbidden", row.code)
            }
        }
    }

    companion object {
        val endpoints =
            mapOf(
                "POST /v1/shops/{shopId}/sync/push" to setOf("SHOP_READ"),
                "GET /v1/shops/{shopId}/sync/pull" to setOf("CUSTOMER_READ", "LEDGER_READ"),
            )

        @JvmStatic
        fun cases(): List<Arguments> = endpoints.keys.flatMap { endpoint -> Caller.entries.map { Arguments.of(endpoint, it) } }
    }
}
