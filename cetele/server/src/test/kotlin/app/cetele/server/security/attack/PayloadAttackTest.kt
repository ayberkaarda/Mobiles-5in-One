package app.cetele.server.security.attack

import app.cetele.server.media.MediaFixtures
import app.cetele.server.media.store.MediaStore
import com.jayway.jsonpath.JsonPath
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Hostile request bodies over real HTTP: oversize and malformed sync batches, bodies over the
 * 1 MB cap (announced and chunked), wrong media types, replayed sync operations, and MIME spoofing
 * on the photo upload path through the real presigned URLs of MinIO.
 */
@AttackTest
class PayloadAttackTest : AttackSupport() {
    @Autowired lateinit var store: MediaStore

    private class Shop(
        val id: UUID,
        val bearer: String,
    ) {
        val push = "/v1/shops/$id/sync/push"
    }

    private fun shop(): Shop {
        val owner = tenancy.actor()
        return Shop(tenancy.shop(owner), owner.bearer)
    }

    private fun upsert(seq: Long) =
        """{"clientId":"${id()}","clientSeq":$seq,"kind":"CUSTOMER_UPSERT","customer":{"id":"${id()}","name":"Müşteri $seq","smsConsent":false}}"""

    private fun rows(
        table: String,
        shopId: UUID,
    ): Int = jdbc.queryForObject("SELECT count(*) FROM $table WHERE shop_id = ?", Int::class.java, shopId)!!

    private fun raw(
        shop: Shop,
        body: ByteArray,
        contentType: String? = "application/json",
        chunked: Boolean = false,
    ): RawHttp.Response {
        val headers = mutableMapOf("Authorization" to shop.bearer)
        if (contentType != null) headers["Content-Type"] = contentType
        return http.exchange("POST", shop.push, headers, body, chunked = chunked)
    }

    @Test
    fun `a sync batch over 500 operations is refused whole`() {
        val shop = shop()
        val body = """{"operations":[${(1L..501L).joinToString(",") { upsert(it) }}]}"""
        val response = call("POST", shop.push, shop.bearer, body)
        assertProblem(response, 422, "validation.failed", "501 operations")
        assertTrue(JsonPath.read<List<String>>(response.text, "$.errors[*].code").contains("too_long"))
        assertEquals(0, rows("customers", shop.id))
        assertEquals(0, rows("change_log", shop.id))
    }

    @Test
    fun `bodies over one megabyte are 413 whether announced or chunked`() {
        val shop = shop()
        // Whitespace keeps the JSON valid, so only the size can stop it.
        val big = (" ".repeat(1024 * 1024 + 1024) + """{"operations":[]}""").toByteArray()
        assertProblem(raw(shop, big), 413, "payload_too_large", "announced length")
        assertProblem(raw(shop, big, chunked = true), 413, "payload_too_large", "chunked")
        assertEquals(0, rows("change_log", shop.id))
    }

    @Test
    fun `malformed and hostile json never reaches a server error`() {
        val shop = shop()
        val bodies =
            listOf(
                "{",
                "[]",
                "null",
                """{"operations":null}""",
                """{"operations":"x"}""",
                """{"operations":[{"clientId":"not-a-uuid","clientSeq":1,"kind":"CUSTOMER_UPSERT"}]}""",
                """{"operations":[{"clientId":"${id()}","clientSeq":1e400,"kind":"CUSTOMER_UPSERT"}]}""",
                """{"operations":[{"clientId":"${id()}","clientSeq":1,"kind":"DROP_TABLE"}]}""",
                """{"operations":[{"clientId":"${id()}","clientSeq":1,"kind":"CUSTOMER_UPSERT","customer":{"id":"${id()}","name":"x","smsConsent":false,"shopId":"${id()}"}}]}""",
                "{\"operations\":" + "[".repeat(5_000) + "]".repeat(5_000) + "}",
                "{\"operations\":[{\"clientId\":\"\u0000\"}]}",
            ).map { it.toByteArray(Charsets.UTF_8) } +
                listOf(
                    byteArrayOf(0x7b, 0xc3.toByte(), 0x28, 0x7d),
                    byteArrayOf(0xef.toByte(), 0xbb.toByte(), 0xbf.toByte()) + "{".toByteArray(),
                )
        bodies.forEachIndexed { index, body ->
            val response = raw(shop, body)
            assertTrue(response.status in 400..499, "body $index answered $response")
            assertNoInternals(response, "body $index")
        }
        assertEquals(0, rows("customers", shop.id))
    }

    @Test
    fun `duplicate json keys resolve to the last value inside the caller's own shop`() {
        // Accepted finding: Jackson keeps the last duplicate; no intermediary parses the body, so there is no parser differential.
        val shop = shop()
        val response = call("POST", shop.push, shop.bearer, """{"operations":[], "operations":[${upsert(1)}]}""")
        assertEquals(200, response.status, response.toString())
        assertEquals(listOf("APPLIED"), JsonPath.read<List<String>>(response.text, "$.results[*].status"))
        assertEquals(1, rows("customers", shop.id))
    }

    @Test
    fun `non json content types are 415 on the api`() {
        val shop = shop()
        val body = """{"operations":[]}""".toByteArray()
        listOf("text/plain", "application/xml", "multipart/form-data; boundary=x", "application/x-www-form-urlencoded", "text/json")
            .forEach { type -> assertProblem(raw(shop, body, type), 415, "unsupported_media_type", type) }
        assertProblem(raw(shop, body, contentType = null), 415, "unsupported_media_type", "no content type")
    }

    @Test
    fun `a replayed sync operation is a duplicate and books nothing twice`() {
        val shop = shop()
        val customer = ledger.customer(shop.id)
        val op =
            """{"clientId":"${id()}","clientSeq":1,"kind":"ENTRY_CREATE","entry":{"id":"${id()}","customerId":"$customer",""" +
                """"type":"DEBT","amountMinor":5000,"occurredOn":"2026-10-01"}}"""
        val first = call("POST", shop.push, shop.bearer, """{"operations":[$op]}""")
        assertEquals("APPLIED", JsonPath.read<List<String>>(first.text, "$.results[*].status").single(), first.toString())
        repeat(3) {
            val replay = call("POST", shop.push, shop.bearer, """{"operations":[$op]}""")
            assertEquals("DUPLICATE", JsonPath.read<List<String>>(replay.text, "$.results[*].status").single(), replay.toString())
        }
        assertEquals(1, rows("ledger_entries", shop.id))
        assertEquals(5000L, ledger.balance(shop.id, customer))
    }

    @Test
    fun `pull parameters outside their bounds are refused`() {
        val shop = shop()
        listOf("since=-1", "limit=0", "limit=501", "limit=100000").forEach { query ->
            assertProblem(get("/v1/shops/${shop.id}/sync/pull?$query", shop.bearer), 422, "validation.failed", query)
        }
        val typed = get("/v1/shops/${shop.id}/sync/pull?since=abc", shop.bearer)
        assertTrue(typed.status in 400..499, typed.toString())
        assertNoInternals(typed)
    }

    @Test
    fun `presign refuses non image types and lengths over the cap`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val path = "/v1/shops/${f.shopId}/media/presign"
        val types = listOf("application/pdf", "image/svg+xml", "text/html", "IMAGE/JPEG", "image/jpeg; charset=utf-8", "image/png", "")
        types.forEach { type ->
            val response = call("POST", path, f.owner.bearer, """{"contentType":"$type","contentLength":1000}""")
            assertProblem(response, 422, "validation.failed", "type '$type'")
        }
        listOf(MediaStore.MAX_BYTES + 1, 0, -1).forEach { length ->
            val response = call("POST", path, f.owner.bearer, """{"contentType":"image/jpeg","contentLength":$length}""")
            assertProblem(response, 422, "validation.failed", "length $length")
        }
        assertEquals(0, rows("media_objects", f.shopId))
    }

    @Test
    fun `a pdf uploaded through the presigned url as jpeg is rejected and deleted`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val pdf = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n".toByteArray()
        val (mediaId, presigned) = presign(f, pdf.size)
        assertEquals(200, put(presigned, pdf), "storage accepts the bytes: the declared type is all it can check")
        assertProblem(complete(f, mediaId), 422, "media.invalid", "pdf disguised as jpeg")
        assertEquals("FAILED", f.status(mediaId))
        assertNull(store.head(f.uploadKey(mediaId)), "the original upload is deleted")
        assertProblem(get("/v1/shops/${f.shopId}/media/$mediaId", f.owner.bearer), 409, "media.not_ready", "download of a failed upload")
    }

    @Test
    fun `svg and html declared as images are rejected`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val payloads =
            listOf(
                """<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>""".toByteArray(),
                "<!doctype html><html><body><script>alert(1)</script></body></html>".toByteArray(),
                "GIF89a".toByteArray() + ByteArray(32),
            )
        payloads.forEach { bytes ->
            val (mediaId, presigned) = presign(f, bytes.size, "image/webp")
            assertEquals(200, put(presigned, bytes))
            assertProblem(complete(f, mediaId), 422, "media.invalid", bytes.decodeToString().take(20))
            assertNull(store.head(f.uploadKey(mediaId)))
        }
    }

    @Test
    fun `storage refuses a content type or a length other than the signed ones`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val jpeg = MediaFixtures.jpeg()
        val (mediaId, presigned) = presign(f, jpeg.size)
        val asHtml = put(presigned, jpeg, contentType = "text/html")
        assertTrue(asHtml in 400..499, "content type swapped after signing: $asHtml")
        val longer = put(presigned, jpeg + ByteArray(1024))
        assertTrue(longer in 400..499, "body longer than the signed length: $longer")
        assertNull(store.head(f.uploadKey(mediaId)))
        assertProblem(complete(f, mediaId), 409, "media.not_uploaded", "nothing was stored")
    }

    @Test
    fun `a jpeg polyglot with an html tail is re-encoded without the tail`() {
        val f = MediaFixtures(mvc, auth, jdbc, store)
        val polyglot = MediaFixtures.jpeg(64, 64) + "<html><script>alert(document.cookie)</script></html>".toByteArray()
        val (mediaId, presigned) = presign(f, polyglot.size)
        assertEquals(200, put(presigned, polyglot))
        val completed = complete(f, mediaId)
        assertEquals(200, completed.status, completed.toString())
        val stored = store.get(JsonPath.read(completed.text, "$.photoKey"))
        assertFalse(stored.decodeToString().contains("<script"), "the re-encoded photo carries no script")
        assertNull(store.head(f.uploadKey(mediaId)))
    }

    private fun presign(
        f: MediaFixtures,
        length: Int,
        type: String = "image/jpeg",
    ): Pair<UUID, RawHttp.Response> {
        val response =
            call("POST", "/v1/shops/${f.shopId}/media/presign", f.owner.bearer, """{"contentType":"$type","contentLength":$length}""")
        assertEquals(201, response.status, response.toString())
        return UUID.fromString(JsonPath.read(response.text, "$.mediaId")) to response
    }

    private fun complete(
        f: MediaFixtures,
        mediaId: UUID,
    ) = call("POST", "/v1/shops/${f.shopId}/media/$mediaId/complete", f.owner.bearer)

    /** PUTs [bytes] to the presigned URL; the client sets Content-Length from the bytes. */
    private fun put(
        presigned: RawHttp.Response,
        bytes: ByteArray,
        contentType: String = JsonPath.read(presigned.text, "$.headers.Content-Type"),
    ): Int {
        val request =
            HttpRequest
                .newBuilder(URI.create(JsonPath.read<String>(presigned.text, "$.uploadUrl")))
                .header("Content-Type", contentType)
                .PUT(HttpRequest.BodyPublishers.ofByteArray(bytes))
                .build()
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.discarding()).statusCode()
    }
}
