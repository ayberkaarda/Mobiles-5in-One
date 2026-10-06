package app.cetele.server.account

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
class AccountPermissionTest : AccountTestSupport() {
    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    private lateinit var mappings: RequestMappingHandlerMapping

    @Test
    fun `table covers every account handler with the exact permission set`() {
        val actual =
            mappings.handlerMethods
                .filter {
                    it.value.beanType.packageName
                        .startsWith("app.cetele.server.account.web")
                }.map { (info, handler) ->
                    val expression = assertNotNull(handler.getMethodAnnotation(PreAuthorize::class.java)).value
                    val codes = Regex("'([A-Z_]+)'").findAll(expression).map { it.groupValues[1] }.toSet()
                    if (codes.isEmpty()) assertEquals("isAuthenticated()", expression)
                    "${info.methodsCondition.methods.single().name} ${info.pathPatternsCondition!!.patternValues.single()}" to codes
                }.toMap()
        assertEquals(TABLE, actual)
    }

    @Test
    fun `shop handlers obey role matrix and foreign shop returns not found`() {
        listOf("delete", "cancel", "transfer").forEach { action ->
            listOf("OWNER", "STAFF", "NON_MEMBER").forEach { role ->
                val owner = actor()
                val staff = actor()
                val target = actor()
                val shopId = fixtures.shop(owner.actor)
                fixtures.addStaff(shopId, staff.actor)
                fixtures.addStaff(shopId, target.actor)
                val caller =
                    when (role) {
                        "OWNER" -> owner
                        "STAFF" -> staff
                        else -> actor()
                    }
                if (action == "cancel") {
                    assertEquals(202, delete("/v1/shops/$shopId", owner, mapOf("code" to code(owner))).status)
                }
                val response =
                    when (action) {
                        "delete" -> {
                            delete("/v1/shops/$shopId", caller, mapOf("code" to code(caller)))
                        }

                        "cancel" -> {
                            delete("/v1/shops/$shopId/deletion", caller)
                        }

                        else -> {
                            post(
                                "/v1/shops/$shopId/ownership-transfer",
                                caller,
                                mapOf(
                                    "userId" to target.actor.id,
                                    "code" to code(caller),
                                ),
                            )
                        }
                    }
                when {
                    role == "NON_MEMBER" -> {
                        problem(response, 404, "not_found")
                    }

                    !PermissionMatrix.isAllowed(ShopRole.valueOf(role), Permission.MembersManage) -> {
                        problem(response, 403, "forbidden")
                    }

                    else -> {
                        assertEquals(
                            when (action) {
                                "delete" -> 202
                                "cancel" -> 204
                                else -> 200
                            },
                            response.status,
                            response.contentAsString,
                        )
                    }
                }
            }
        }
    }

    @Test
    fun `account handlers accept authenticated users of either role`() {
        listOf("OWNER", "STAFF").forEach { role ->
            val owner = actor()
            val caller = if (role == "OWNER") owner else actor()
            val shopId = fixtures.shop(owner.actor)
            if (role == "STAFF") fixtures.addStaff(shopId, caller.actor)
            assertEquals(202, post("/v1/auth/reauth/request", caller).status)
            assertEquals(202, delete("/v1/me", caller, mapOf("code" to code(caller), "deleteOwnedShops" to true)).status)
            assertEquals(204, delete("/v1/me/deletion", caller).status)
        }
        mvc
            .perform(
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                    .post("/v1/auth/reauth/request"),
            ).andExpect(
                org.springframework.test.web.servlet.result.MockMvcResultMatchers
                    .status()
                    .isUnauthorized,
            )
        listOf("/v1/me", "/v1/me/deletion").forEach { path ->
            mvc
                .perform(
                    org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete(path),
                ).andExpect(
                    org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status()
                        .isUnauthorized,
                )
        }
    }

    companion object {
        private val TABLE =
            mapOf(
                "POST /v1/auth/reauth/request" to emptySet(),
                "DELETE /v1/me" to emptySet(),
                "DELETE /v1/me/deletion" to emptySet(),
                "DELETE /v1/shops/{shopId}" to setOf("MEMBERS_MANAGE"),
                "DELETE /v1/shops/{shopId}/deletion" to setOf("MEMBERS_MANAGE"),
                "POST /v1/shops/{shopId}/ownership-transfer" to setOf("MEMBERS_MANAGE"),
            )
    }
}
