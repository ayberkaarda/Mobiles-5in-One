package app.cetele.server.admin

import app.cetele.server.admin.totp.TotpCipher
import app.cetele.server.admin.totp.TotpService
import app.cetele.server.support.TestAuth
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockHttpSession
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.get

/** Shared wiring of the console integration tests; subclasses carry @IntegrationTest (one shared context). */
abstract class AdminIntegrationTest {
    @Autowired lateinit var mvc: MockMvc

    @Autowired lateinit var jdbc: JdbcTemplate

    @Autowired lateinit var auth: TestAuth

    @Autowired lateinit var accounts: AdminAccountRepository

    @Autowired lateinit var passwords: AdminPasswords

    @Autowired lateinit var cipher: TotpCipher

    @Autowired lateinit var totp: TotpService

    val admins: AdminTestSupport by lazy { AdminTestSupport(mvc, accounts, passwords, cipher, totp, jdbc) }

    fun page(
        path: String,
        session: MockHttpSession?,
    ): MvcResult =
        mvc
            .get(path) {
                if (session != null) this.session = session
            }.andReturn()
}
