package app.cetele.server.reminders.sms

import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SmsConfigurationTest {
    private fun runner(
        profile: String,
        vararg properties: String,
    ): ApplicationContextRunner =
        ApplicationContextRunner()
            .withInitializer { it.environment.setActiveProfiles(profile) }
            .withUserConfiguration(SmsConfiguration::class.java)
            .withPropertyValues(*properties)

    @Test
    fun `netgsm requires every credential with the contract startup message`() {
        val password = "test-" + java.util.UUID.randomUUID()
        val credentials =
            listOf("cetele.sms.netgsm.username=test-user", "cetele.sms.netgsm.password=$password", "cetele.sms.netgsm.msgheader=CETELE")
        for (missing in credentials.indices) {
            runner("staging", "cetele.sms.provider=netgsm", *credentials.filterIndexed { index, _ -> index != missing }.toTypedArray())
                .run { context ->
                    assertNotNull(context.startupFailure)
                    val messages = generateSequence(context.startupFailure) { it.cause }.mapNotNull { it.message }
                    assertTrue(messages.any { it == "CETELE_SMS_PROVIDER=netgsm needs CETELE_NETGSM_USERNAME, _PASSWORD and _MSGHEADER" })
                }
        }
    }

    @Test
    fun `fake is refused in staging`() {
        runner("staging", "cetele.sms.provider=fake").run { context ->
            assertNotNull(context.startupFailure)
            val messages = generateSequence(context.startupFailure) { it.cause }.mapNotNull { it.message }
            assertTrue(messages.any { it == "fake adapter fake-sms-gateway is not allowed in profiles [staging]" })
        }
    }

    @Test
    fun `netgsm credentials build the real adapter without contacting the provider`() {
        runner(
            "staging",
            "cetele.sms.provider=netgsm",
            "cetele.sms.netgsm.username=test-user",
            "cetele.sms.netgsm.password=" + java.util.UUID.randomUUID(),
            "cetele.sms.netgsm.msgheader=CETELE",
            "cetele.sms.netgsm.base-url=",
        ).run { context ->
            assertNull(context.startupFailure)
            assertTrue(context.getBean(SmsGateway::class.java) is NetgsmSmsGateway)
        }
    }

    @Test
    fun `blank base URL uses the documented host and timeout defaults`() {
        val properties = NetgsmProperties(baseUrl = " ")
        assertEquals("https://api.netgsm.com.tr", properties.endpoint())
        assertEquals(java.time.Duration.ofSeconds(5), properties.connectTimeout)
        assertEquals(java.time.Duration.ofSeconds(10), properties.readTimeout)
    }

    @Test
    fun `fake remains available locally`() {
        runner("local", "cetele.sms.provider=fake").run { context ->
            assertNull(context.startupFailure)
            assertTrue(context.getBean(SmsGateway::class.java) is FakeSmsGateway)
        }
    }
}
