package app.cetele.server.media

import app.cetele.server.media.store.MediaStore
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.Actor
import app.cetele.server.tenancy.TenancyFixtures
import com.jayway.jsonpath.JsonPath
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import javax.imageio.ImageIO
import kotlin.test.assertEquals

class MediaFixtures(
    val mvc: MockMvc,
    auth: TestAuth,
    val jdbc: JdbcTemplate,
    val store: MediaStore,
) {
    val tenancy = TenancyFixtures(mvc, auth, jdbc)
    val owner = tenancy.actor()
    val shopId = tenancy.shop(owner)

    fun presign(
        length: Int,
        type: String = "image/jpeg",
        actor: Actor = owner,
    ): String {
        val response =
            mvc
                .post("/v1/shops/$shopId/media/presign") {
                    header(AUTHORIZATION, actor.bearer)
                    contentType = MediaType.APPLICATION_JSON
                    content = """{"contentType":"$type","contentLength":$length}"""
                }.andReturn()
                .response
        assertEquals(201, response.status, response.contentAsString)
        return response.contentAsString
    }

    fun id(body: String): UUID = UUID.fromString(JsonPath.read<String>(body, "$.mediaId"))

    fun key(body: String): String = JsonPath.read(body, "$.photoKey")

    fun uploadKey(id: UUID) = "uploads/$shopId/$id"

    fun complete(
        id: UUID,
        actor: Actor = owner,
        pathShopId: UUID = shopId,
    ) = mvc.post("/v1/shops/$pathShopId/media/$id/complete") {
        header(AUTHORIZATION, actor.bearer)
    }

    fun download(
        id: UUID,
        actor: Actor = owner,
        pathShopId: UUID = shopId,
    ) = mvc.get("/v1/shops/$pathShopId/media/$id") {
        header(AUTHORIZATION, actor.bearer)
    }

    fun ready(bytes: ByteArray = jpeg()): UUID {
        val body = presign(bytes.size)
        val id = id(body)
        store.put(uploadKey(id), bytes, "image/jpeg")
        complete(id).andExpect { status { isOk() } }
        return id
    }

    fun status(id: UUID): String =
        jdbc.queryForObject("SELECT status FROM media_objects WHERE shop_id = ? AND id = ?", String::class.java, shopId, id)!!

    fun putSigned(
        body: String,
        bytes: ByteArray,
    ): Int {
        val headers = JsonPath.read<Map<String, String>>(body, "$.headers")
        val builder =
            HttpRequest
                .newBuilder(URI.create(JsonPath.read<String>(body, "$.uploadUrl")))
                .header("Content-Type", headers.getValue("Content-Type"))
                .PUT(HttpRequest.BodyPublishers.ofByteArray(bytes))
        return HttpClient.newHttpClient().send(builder.build(), HttpResponse.BodyHandlers.discarding()).statusCode()
    }

    companion object {
        fun jpeg(
            width: Int = 40,
            height: Int = 20,
        ): ByteArray {
            val output = ByteArrayOutputStream()
            check(ImageIO.write(BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), "jpeg", output))
            return output.toByteArray()
        }
    }
}
