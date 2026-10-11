package app.cetele.server.security.xss

import app.cetele.server.config.CeteleTime
import app.cetele.server.security.TraceIdFilter
import app.cetele.server.statements.StatementData
import app.cetele.server.statements.StatementPdf
import app.cetele.server.statements.StatementRow
import app.cetele.server.statements.link.StatementLinkService
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.TestAuth
import app.cetele.server.sync.CustomerInput
import app.cetele.server.sync.EntryInput
import app.cetele.server.sync.OperationKind
import app.cetele.server.sync.OperationStatus
import app.cetele.server.sync.PushRequest
import app.cetele.server.sync.PushResponse
import app.cetele.server.sync.SyncOperation
import app.cetele.server.tenancy.ShopWorld
import app.cetele.server.tenancy.TenancyFixtures
import org.apache.pdfbox.Loader
import org.apache.pdfbox.text.PDFTextStripper
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Item 16 on the statement surfaces: the corpus is written through the real write paths (sync push
 * for customer name, note, tag and entry note; `PATCH /v1/shops/{id}` for the shop name), then
 * read back from the statement page, the PDF fallback and the sync pull.
 */
@IntegrationTest
class StoredXssStatementTest(
    @Autowired private val mvc: MockMvc,
    @Autowired private val auth: TestAuth,
    @Autowired private val jdbc: JdbcTemplate,
    @Autowired private val mapper: ObjectMapper,
    @Autowired private val clock: Clock,
    @Autowired private val links: StatementLinkService,
    @Autowired private val pdfRenderer: StatementPdf,
) {
    private data class Stored(
        val payload: String,
        val customerId: UUID,
    )

    private fun ip(): String = "10.${(1..3).joinToString(".") { (1..254).random().toString() }}"

    private fun push(
        world: ShopWorld,
        operations: List<SyncOperation>,
    ): PushResponse {
        val response =
            mvc
                .post("/v1/shops/${world.shopId}/sync/push") {
                    header(AUTHORIZATION, world.owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = mapper.writeValueAsString(PushRequest(operations))
                }.andReturn()
                .response
        assertEquals(200, response.status, response.contentAsString)
        return mapper.readValue(response.contentAsString, PushResponse::class.java)
    }

    /** Writes one customer per payload (name, note, tag) and one debt whose note is the payload. */
    private fun store(
        world: ShopWorld,
        payloads: List<String>,
    ): List<Stored> {
        var seq = 0L
        val stored = payloads.map { Stored(it, TraceIdFilter.uuidV7()) }
        val operations =
            stored.flatMap { (payload, id) ->
                val tag = if (payload.length <= 30) payload else XssCorpus.short.first()
                listOf(
                    SyncOperation(
                        TraceIdFilter.uuidV7(),
                        ++seq,
                        OperationKind.CUSTOMER_UPSERT,
                        customer = CustomerInput(id, payload, note = payload, tag = tag, smsConsent = false),
                    ),
                    SyncOperation(
                        TraceIdFilter.uuidV7(),
                        ++seq,
                        OperationKind.ENTRY_CREATE,
                        entry = EntryInput(TraceIdFilter.uuidV7(), id, "DEBT", 12_500L, CeteleTime.today(clock), note = payload),
                    ),
                )
            }
        val result = push(world, operations)
        assertEquals(List(operations.size) { OperationStatus.APPLIED }, result.results.map { it.status }, result.toString())
        stored.forEach { (payload, id) ->
            assertEquals(payload, jdbc.queryForObject("SELECT name FROM customers WHERE id = ?", String::class.java, id))
        }
        return stored
    }

    private fun renameShop(
        world: ShopWorld,
        name: String,
    ) {
        val response =
            mvc
                .patch("/v1/shops/${world.shopId}") {
                    header(AUTHORIZATION, world.owner.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = mapper.writeValueAsString(mapOf("name" to name))
                }.andReturn()
                .response
        assertEquals(200, response.status, response.contentAsString)
        assertEquals(name, jdbc.queryForObject("SELECT name FROM shops WHERE id = ?", String::class.java, world.shopId))
    }

    private fun page(
        world: ShopWorld,
        customerId: UUID,
    ): MockHttpServletResponse {
        val token = links.issue(world.shopId, customerId, world.owner.id, now = clock.instant()).token
        val response =
            mvc
                .get("/s/$token") { with { it.apply { remoteAddr = ip() } } }
                .andReturn()
                .response
        assertEquals(200, response.status)
        assertEquals("text/html;charset=utf-8", response.contentType?.replace(" ", "")?.lowercase())
        return response
    }

    @Test
    fun `statement page shows every stored payload as inert text under a nonce-bound policy`() {
        val world = TenancyFixtures(mvc, auth, jdbc).world()
        // One push: a device's operation sequence restarts in every call of [store].
        val written = store(world, listOf("Ayşe Yılmaz") + XssCorpus.all)
        val baseline = written.first()
        val stored = written.drop(1)
        val reference = page(world, baseline.customerId)
        val skeleton = HtmlInspector.skeleton(reference.contentAsString)
        HtmlInspector.assertInert(reference.contentAsString, "baseline statement")

        stored.forEach { (payload, customerId) ->
            renameShop(world, payload)
            val response = page(world, customerId)
            val html = response.contentAsString
            val where = "statement [$payload]"
            HtmlInspector.assertHeaders(response, where)
            HtmlInspector.assertInert(html, where)
            assertEquals(skeleton, HtmlInspector.skeleton(html), "$where: the markup skeleton changed")
            val text = HtmlInspector.text(html)
            // Customer name (h2), entry note (description cell), shop name (header and footer).
            assertTrue(text.lines().count { it == payload } >= 3, "$where: shown as text")
            assertTrue(text.contains("Bu döküm $payload tarafından"), "$where: footer")
        }
    }

    @Test
    fun `each statement response carries a fresh nonce that only the stylesheet link uses`() {
        val world = TenancyFixtures(mvc, auth, jdbc).world()
        val stored = store(world, listOf(XssCorpus.markup.first())).single()
        val nonces =
            (1..2).map {
                val response = page(world, stored.customerId)
                val directives = HtmlInspector.assertHeaders(response, "statement")
                val nonce =
                    directives
                        .getValue("script-src")
                        .single { it.startsWith("'nonce-") }
                        .removePrefix("'nonce-")
                        .removeSuffix("'")
                assertTrue(nonce.length >= 22, "128-bit nonce")
                assertEquals(directives.getValue("style-src"), listOf("'self'", "'nonce-$nonce'"))
                val carriers = HtmlInspector.tags(response.contentAsString).filter { it.attribute("nonce") != null }
                assertEquals(listOf("link"), carriers.map { it.name })
                assertEquals(nonce, carriers.single().attribute("nonce"))
                nonce
            }
        assertNotEquals(nonces[0], nonces[1])
    }

    @Test
    fun `sync pull returns stored payloads unchanged as json with nosniff`() {
        val world = TenancyFixtures(mvc, auth, jdbc).world()
        store(world, XssCorpus.all)
        val response =
            mvc
                .get("/v1/shops/${world.shopId}/sync/pull?since=0&limit=500") { header(AUTHORIZATION, world.owner.bearer) }
                .andReturn()
                .response
        assertEquals(200, response.status)
        assertTrue(response.contentType!!.startsWith(MediaType.APPLICATION_JSON_VALUE))
        HtmlInspector.assertHeaders(response, "sync pull")
        val values = mutableSetOf<String>()

        fun collect(node: JsonNode) {
            when {
                node.isString -> values += node.stringValue()
                node.isContainer -> node.forEach { collect(it) }
            }
        }
        collect(mapper.readTree(response.contentAsString))
        XssCorpus.all.forEach { assertTrue(it in values, "pull round-trips [$it]") }
        XssCorpus.short.forEach { assertTrue(it in values, "tag round-trips [$it]") }
    }

    @Test
    fun `pdf export carries payloads as plain text with no active content`() {
        val world = TenancyFixtures(mvc, auth, jdbc).world()
        val stored = store(world, XssCorpus.ascii.take(PDF_DOWNLOADS))
        stored.forEach { (payload, customerId) ->
            renameShop(world, payload)
            val response =
                mvc
                    .get("/v1/shops/${world.shopId}/customers/$customerId/statement.pdf") { header(AUTHORIZATION, world.owner.bearer) }
                    .andReturn()
                    .response
            assertEquals(200, response.status)
            assertEquals(MediaType.APPLICATION_PDF_VALUE, response.contentType)
            assertTrue(response.getHeader("Content-Disposition")!!.startsWith("attachment;"))
            HtmlInspector.assertHeaders(response, "pdf [$payload]")
            assertPassivePdf(response.contentAsByteArray, payload, "pdf download [$payload]")
        }
    }

    @Test
    fun `pdf renderer keeps every corpus payload in shop, customer and description as passive text`() {
        XssCorpus.all.forEach { payload ->
            val data =
                StatementData(
                    shopName = payload,
                    customerName = payload,
                    date = "01.01.2026",
                    rows = listOf(StatementRow("01.01.2026", payload, "125,00 ₺", "", "125,00 ₺", false)),
                    balance = "125,00 ₺",
                )
            assertPassivePdf(pdfRenderer.render(data), payload, "pdf render [$payload]")
        }
    }

    private fun assertPassivePdf(
        bytes: ByteArray,
        payload: String,
        where: String,
    ) {
        Loader.loadPDF(bytes).use { document ->
            val catalog = document.documentCatalog
            assertNull(catalog.openAction, "$where: open action")
            assertNull(catalog.names?.javaScript, "$where: document JavaScript")
            assertNull(catalog.acroForm, "$where: form")
            assertNull(catalog.cosObject.getDictionaryObject("AA"), "$where: catalog additional actions")
            document.pages.forEach { page ->
                assertTrue(page.annotations.isEmpty(), "$where: annotations")
                assertNull(page.cosObject.getDictionaryObject("AA"), "$where: page additional actions")
            }
            if (payload.all { it in ' '..'~' }) {
                val text = PDFTextStripper().getText(document).filterNot { it.isWhitespace() }
                assertTrue(text.contains(payload.filterNot { it.isWhitespace() }), "$where: literal text")
            }
        }
    }

    private companion object {
        /** Below the per-user PDF limit of the shared test context. */
        const val PDF_DOWNLOADS = 6
    }
}
