package app.cetele.server.statements

import app.cetele.server.ledger.LedgerFixtures
import app.cetele.server.statements.link.StatementLinkService
import app.cetele.server.support.TestAuth
import app.cetele.server.tenancy.ShopWorld
import app.cetele.server.tenancy.TenancyFixtures
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import java.util.UUID

abstract class StatementTestSupport {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var auth: TestAuth

    @Autowired lateinit var jdbc: JdbcTemplate

    @Autowired lateinit var mapper: ObjectMapper

    @Autowired lateinit var clock: Clock

    @Autowired lateinit var links: StatementLinkService

    fun world() = TenancyFixtures(mvc, auth, jdbc).world()

    fun ledger() = LedgerFixtures(jdbc, clock)

    fun issue(
        world: ShopWorld,
        customerId: UUID,
        bearer: String = world.owner.bearer,
    ): MockHttpServletResponse =
        mvc
            .post("/v1/shops/${world.shopId}/statement-links") {
                header(AUTHORIZATION, bearer)
                contentType = MediaType.APPLICATION_JSON
                content = mapper.writeValueAsString(StatementLinkRequest(customerId))
            }.andReturn()
            .response

    fun open(
        token: String,
        ip: String = UUID.randomUUID().toString(),
    ): MockHttpServletResponse =
        mvc
            .get("/s/$token") {
                with { request ->
                    request.remoteAddr = ip
                    request
                }
            }.andReturn()
            .response

    fun pdf(
        world: ShopWorld,
        customerId: UUID,
        bearer: String = world.owner.bearer,
    ): MockHttpServletResponse =
        mvc.get("/v1/shops/${world.shopId}/customers/$customerId/statement.pdf") { header(AUTHORIZATION, bearer) }.andReturn().response
}
