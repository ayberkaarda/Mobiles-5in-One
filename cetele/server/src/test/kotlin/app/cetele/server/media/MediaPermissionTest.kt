package app.cetele.server.media

import app.cetele.server.media.store.MediaStore
import app.cetele.server.security.Permission
import app.cetele.server.security.PermissionMatrix
import app.cetele.server.security.ShopRole
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.TenancyFixtures.Companion.expectProblem
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.post
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

@IntegrationTest
class MediaPermissionTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val store: MediaStore,
    @Autowired @Qualifier("requestMappingHandlerMapping") private val mappings: RequestMappingHandlerMapping,
) {
    private val endpoints =
        mapOf(
            "POST /v1/shops/{shopId}/media/presign" to setOf("MEDIA_PRESIGN"),
            "POST /v1/shops/{shopId}/media/{mediaId}/complete" to setOf("MEDIA_PRESIGN"),
            "GET /v1/shops/{shopId}/media/{mediaId}" to setOf("LEDGER_READ"),
        )

    @Test
    fun `permission table and handler annotations cover each other`() {
        val annotated =
            mappings.handlerMethods
                .filter { it.value.beanType.packageName == "app.cetele.server.media.web" }
                .map { (mapping, handler) ->
                    val expression = assertNotNull(handler.getMethodAnnotation(PreAuthorize::class.java)).value
                    val codes = Regex("'([A-Z_]+)'").findAll(expression).map { it.groupValues[1] }.toSet()
                    assertEquals("@perm.can(#shopId, '${codes.single()}')", expression)
                    "${mapping.methodsCondition.methods.single().name} ${mapping.pathPatternsCondition!!.patternValues.single()}" to codes
                }.toMap()
        assertEquals(endpoints, annotated)
    }

    @Test
    fun `owner staff and nonmember outcomes follow the permission matrix`() {
        ShopRole.entries.filter { it == ShopRole.OWNER || it == ShopRole.STAFF }.forEach { role ->
            val f = MediaFixtures(mvc, auth, jdbc, store)
            val actor = if (role == ShopRole.OWNER) f.owner else f.tenancy.addStaff(f.shopId)
            val bytes = MediaFixtures.jpeg()
            val response =
                mvc.post("/v1/shops/${f.shopId}/media/presign") {
                    header(AUTHORIZATION, actor.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"contentType":"image/jpeg","contentLength":${bytes.size}}"""
                }
            if (PermissionMatrix.isAllowed(role, Permission.MediaPresign)) {
                response.andExpect { status { isCreated() } }
                val id = f.id(response.andReturn().response.contentAsString)
                store.put(f.uploadKey(id), bytes, "image/jpeg")
                f.complete(id, actor).andExpect { status { isOk() } }
                assertEquals(
                    PermissionMatrix.isAllowed(role, Permission.LedgerRead),
                    f
                        .download(id, actor)
                        .andReturn()
                        .response.status == 200,
                )
            } else {
                response.expectProblem(403, "forbidden")
            }
        }
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val stranger = f.tenancy.actor()
        val id = f.ready()
        mvc
            .post("/v1/shops/${f.shopId}/media/presign") {
                header(AUTHORIZATION, stranger.bearer)
                contentType = MediaType.APPLICATION_JSON
                content = """{"contentType":"image/jpeg","contentLength":100}"""
            }.expectProblem(404, "not_found")
        f.complete(id, stranger).expectProblem(404, "not_found")
        f.download(id, stranger).expectProblem(404, "not_found")
    }
}
