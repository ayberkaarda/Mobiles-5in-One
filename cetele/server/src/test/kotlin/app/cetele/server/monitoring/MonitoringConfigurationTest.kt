package app.cetele.server.monitoring

import app.cetele.server.config.SmsLimitsProperties
import app.cetele.server.reminders.sms.NetgsmProperties
import org.junit.jupiter.api.Test
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.test.context.assertj.AssertableApplicationContext
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.context.annotation.Configuration
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MonitoringConfigurationTest {
    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(
        AlertProperties::class,
        NetgsmProperties::class,
        SmsBalanceAlertProperties::class,
        SmsLimitsProperties::class,
    )
    class Properties

    private val key = "re_test_" + UUID.randomUUID().toString().replace("-", "")
    private val resend =
        arrayOf(
            "cetele.alerts.mailer=resend",
            "cetele.alerts.to=ops@example.test",
            "cetele.alerts.from=alerts@example.test",
            "cetele.alerts.resend.api-key=$key",
        )
    private val netgsm =
        arrayOf(
            "cetele.sms.provider=netgsm",
            "cetele.sms.netgsm.username=test-user",
            "cetele.sms.netgsm.password=test-pass",
        )

    private fun runner(
        profile: String,
        vararg properties: String,
    ): ApplicationContextRunner =
        ApplicationContextRunner()
            .withInitializer { it.environment.setActiveProfiles(*profile.split(',').toTypedArray()) }
            .withUserConfiguration(MonitoringConfiguration::class.java, Properties::class.java)
            .withPropertyValues(*properties)

    private fun AssertableApplicationContext.messages(): List<String> {
        val failure = assertNotNull(startupFailure)
        return generateSequence(failure) { it.cause }.mapNotNull { it.message }.toList()
    }

    @Test
    fun `local and test use the fakes when nothing is selected`() {
        listOf("local", "test").forEach { profile ->
            runner(profile).run { context ->
                assertNull(context.startupFailure)
                assertTrue(context.getBean(SmsBalanceProvider::class.java) is FakeSmsBalanceProvider)
                assertTrue(context.getBean(AlertMailer::class.java) is FakeAlertMailer)
            }
        }
    }

    @Test
    fun `production profiles refuse the fakes and an empty selection`() {
        listOf("staging", "prod", "prod,local").forEach { profile ->
            runner(profile, "cetele.alerts.mailer=fake", *netgsm).run { context ->
                assertTrue(context.messages().any { it.startsWith("fake adapter fake-alert-mailer is not allowed in profiles") })
            }
            runner(profile, "cetele.sms.provider=fake", *resend).run { context ->
                assertTrue(context.messages().any { it.startsWith("fake adapter fake-sms-balance-provider is not allowed in profiles") })
            }
            runner(profile, *netgsm).run { context ->
                assertTrue(context.messages().any { it == "CETELE_ALERT_MAILER must be set" })
            }
        }
        runner("staging", "cetele.alerts.mailer=smtp", *netgsm).run { context ->
            assertTrue(context.messages().any { it == "unknown CETELE_ALERT_MAILER" })
        }
    }

    @Test
    fun `resend needs key, sender and recipients and the failure never repeats the key`() {
        for (missing in 1 until resend.size) {
            runner("staging", *netgsm, *resend.filterIndexed { index, _ -> index != missing }.toTypedArray()).run { context ->
                val messages = context.messages()
                assertTrue(
                    messages.any {
                        it == "CETELE_ALERT_MAILER=resend needs CETELE_RESEND_API_KEY, CETELE_MAIL_FROM and CETELE_ALERT_EMAIL_TO"
                    },
                )
                assertFalse(messages.any { it.contains(key) })
            }
        }
    }

    @Test
    fun `staging with netgsm and resend gets the HTTP adapters`() {
        runner("staging", *netgsm, *resend).run { context ->
            assertNull(context.startupFailure)
            assertTrue(context.getBean(SmsBalanceProvider::class.java) is NetgsmSmsBalanceProvider)
            assertTrue(context.getBean(AlertMailer::class.java) is ResendAlertMailer)
        }
        runner("staging", "cetele.sms.provider=netgsm", *resend).run { context ->
            assertTrue(context.messages().any { it == "CETELE_SMS_PROVIDER=netgsm needs CETELE_NETGSM_USERNAME and _PASSWORD" })
        }
    }

    @Test
    fun `the global daily SMS cap binds from its property and cannot be zero or negative`() {
        runner("test").run { context -> assertEquals(1000, context.getBean(SmsLimitsProperties::class.java).dailyCap) }
        runner("test", "cetele.sms.daily-cap=25").run { context ->
            assertEquals(25, context.getBean(SmsLimitsProperties::class.java).dailyCap)
        }
        listOf("0", "-1").forEach { value ->
            runner("test", "cetele.sms.daily-cap=$value").run { context ->
                assertTrue(context.messages().any { it == "CETELE_SMS_DAILY_CAP must be positive" }, value)
            }
        }
    }

    @Test
    fun `thresholds bind from their properties and invalid values fail startup`() {
        runner(
            "test",
            "cetele.monitoring.sms-balance.min-credit=250",
            "cetele.monitoring.sms-balance.last-top-up=5000",
            "cetele.monitoring.sms-balance.top-up-percent=25",
        ).run { context ->
            assertEquals(SmsBalanceAlertProperties(250, 5000, 25), context.getBean(SmsBalanceAlertProperties::class.java))
        }
        runner("test").run { context ->
            assertEquals(SmsBalanceAlertProperties(500, 0, 20), context.getBean(SmsBalanceAlertProperties::class.java))
        }
        listOf(
            "cetele.monitoring.sms-balance.min-credit=-1",
            "cetele.monitoring.sms-balance.last-top-up=-1",
            "cetele.monitoring.sms-balance.top-up-percent=0",
            "cetele.monitoring.sms-balance.top-up-percent=101",
        ).forEach { property ->
            runner("test", property).run { context -> assertNotNull(context.startupFailure, property) }
        }
    }
}
