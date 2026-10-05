package app.cetele.server.web

import app.cetele.server.support.IntegrationTest
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.test.json.JsonCompareMode
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post

@IntegrationTest
class PublicSurfaceTest(
    @Autowired private val mvc: MockMvc,
) {
    @Test
    fun `health is public and reports only the status`() {
        mvc.get("/actuator/health").andExpect {
            status { isOk() }
            content { json("""{"status":"UP"}""", JsonCompareMode.STRICT) }
        }
    }

    @Test
    fun `other actuator endpoints are not reachable`() {
        listOf("/actuator", "/actuator/env", "/actuator/info", "/actuator/health/db").forEach { path ->
            mvc.get(path).andExpect { status { isUnauthorized() } }
        }
    }

    @Test
    fun `everything else is denied by default`() {
        mvc.get("/v1/me").andExpect { status { isUnauthorized() } }
        mvc.post("/v1/auth/otp/request").andExpect { status { isUnauthorized() } }
        mvc.get("/").andExpect { status { isUnauthorized() } }
    }
}
