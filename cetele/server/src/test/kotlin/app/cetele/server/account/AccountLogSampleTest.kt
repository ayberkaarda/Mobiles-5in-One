package app.cetele.server.account

import app.cetele.server.account.deletion.DeletionExecutor
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.assertContains
import app.cetele.server.support.assertNoneOf
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.system.CapturedOutput
import java.time.Instant
import kotlin.test.assertEquals

@IntegrationTest
@LogCapture
class AccountLogSampleTest : AccountTestSupport() {
    @Autowired private lateinit var executor: DeletionExecutor

    @Autowired private lateinit var sms: FakeSmsGateway

    @Test
    fun `deletion logs contain outcomes without phone code or token`(output: CapturedOutput) {
        val user = actor()
        fixtures.shop(user.actor)
        assertEquals(202, post("/v1/auth/reauth/request", user).status)
        val value = Regex("[0-9]{6}").find(checkNotNull(sms.lastMessageTo(user.actor.phone)).text)!!.value
        assertEquals(202, delete("/v1/me", user, mapOf("code" to value)).status)
        expire(user)
        executor.run(Instant.now())
        assertEquals(0, count("users", "id", user.actor.id))
        output.assertContains("account deletion completed")
        output.assertNoneOf(user.actor.phone, value, user.actor.bearer.removePrefix("Bearer "))
    }
}
