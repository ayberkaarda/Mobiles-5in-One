package app.cetele.server.monitoring

import app.cetele.server.config.JobLocks
import app.cetele.server.support.IntegrationTest
import app.cetele.server.support.LogCapture
import app.cetele.server.support.assertContains
import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.simple.SimpleMeterRegistry
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.scheduling.annotation.Scheduled
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

@IntegrationTest
@LogCapture
class SmsBalanceMonitorTest(
    @Autowired private val jobs: JobLocks,
    @Autowired private val contextMonitor: SmsBalanceMonitor,
    @Autowired private val contextRegistry: MeterRegistry,
    @Autowired private val contextProvider: SmsBalanceProvider,
    @Autowired private val contextMailer: AlertMailer,
) {
    /** 09:00 Istanbul on 2026-10-12. */
    private val morning = Instant.parse("2026-10-12T06:00:00Z")
    private val nextMorning = morning.plusSeconds(86_400)

    private inner class World(
        properties: SmsBalanceAlertProperties = SmsBalanceAlertProperties(minCredit = 500, lastTopUp = 0, topUpPercent = 20),
    ) {
        val provider = FakeSmsBalanceProvider()
        val mailer = FakeAlertMailer()
        val registry = SimpleMeterRegistry()
        val monitor = SmsBalanceMonitor(provider, mailer, properties, jobs, Clock.fixed(morning, ZoneOffset.UTC), registry)

        fun gauge(): Double = registry.get(SmsBalanceMonitor.BALANCE_GAUGE).gauge().value()

        fun alerts(rule: SmsBalanceRule): Double =
            registry
                .find(SmsBalanceMonitor.ALERT_COUNTER)
                .tag("rule", rule.tag)
                .counter()
                ?.count() ?: 0.0
    }

    @Test
    fun `credit below the absolute threshold alerts once per Istanbul day by log and mail`(output: CapturedOutput) {
        val world = World()
        world.provider.set(499)
        val first = assertNotNull(world.monitor.check(morning))
        assertEquals(setOf(SmsBalanceRule.BELOW_MINIMUM), first.alerted)
        assertEquals(499.0, world.gauge())
        assertEquals(1, world.mailer.sent().size)
        assertTrue(
            world.mailer
                .sent()[0]
                .text
                .contains("credit=499 threshold=500"),
        )
        output.assertContains("SMS balance alert rule=below_minimum credit=499 threshold=500")

        world.provider.set(450)
        val again = assertNotNull(world.monitor.check(morning.plusSeconds(3_600)))
        assertEquals(setOf(SmsBalanceRule.BELOW_MINIMUM), again.breached)
        assertEquals(emptySet(), again.alerted)
        assertEquals(450.0, world.gauge())
        assertEquals(1, world.mailer.sent().size)
        assertEquals(1.0, world.alerts(SmsBalanceRule.BELOW_MINIMUM))

        // Istanbul midnight is 21:00 UTC: one second later is the next day.
        val afterMidnight = Instant.parse("2026-10-12T21:00:01Z")
        assertEquals(setOf(SmsBalanceRule.BELOW_MINIMUM), assertNotNull(world.monitor.check(afterMidnight)).alerted)
        assertEquals(2, world.mailer.sent().size)
        assertEquals(2.0, world.alerts(SmsBalanceRule.BELOW_MINIMUM))
    }

    @Test
    fun `credit at the threshold does not alert`() {
        val world = World()
        world.provider.set(500)
        val result = assertNotNull(world.monitor.check(morning))
        assertEquals(emptySet(), result.breached)
        assertEquals(emptyList(), world.mailer.sent())
        assertEquals(0.0, world.alerts(SmsBalanceRule.BELOW_MINIMUM))
    }

    @Test
    fun `credit below twenty percent of the configured top-up alerts separately`() {
        val world = World(SmsBalanceAlertProperties(minCredit = 100, lastTopUp = 10_000, topUpPercent = 20))
        world.provider.set(2_000)
        assertEquals(emptySet(), assertNotNull(world.monitor.check(morning)).breached)
        world.provider.set(1_999)
        val result = assertNotNull(world.monitor.check(morning))
        assertEquals(setOf(SmsBalanceRule.BELOW_TOP_UP_SHARE), result.alerted)
        assertTrue(
            world.mailer
                .sent()
                .single()
                .text
                .contains("credit=1999 topUp=10000 percent=20"),
        )
        world.provider.set(99)
        val both = assertNotNull(world.monitor.check(morning))
        assertEquals(setOf(SmsBalanceRule.BELOW_MINIMUM, SmsBalanceRule.BELOW_TOP_UP_SHARE), both.breached)
        assertEquals(setOf(SmsBalanceRule.BELOW_MINIMUM), both.alerted)
        assertEquals(2, world.mailer.sent().size)
    }

    @Test
    fun `a rise seen by the monitor becomes the top-up reference`() {
        val world = World(SmsBalanceAlertProperties(minCredit = 0, lastTopUp = 0, topUpPercent = 20))
        world.provider.set(300)
        assertEquals(emptySet(), assertNotNull(world.monitor.check(morning)).breached)
        world.provider.set(5_000)
        assertEquals(emptySet(), assertNotNull(world.monitor.check(morning)).breached)
        world.provider.set(999)
        assertEquals(setOf(SmsBalanceRule.BELOW_TOP_UP_SHARE), assertNotNull(world.monitor.check(morning)).alerted)
        assertEquals(1.0, world.alerts(SmsBalanceRule.BELOW_TOP_UP_SHARE))
    }

    @Test
    fun `an unreadable balance alerts as unknown and the gauge is NaN, never zero`(output: CapturedOutput) {
        val world = World()
        world.provider.set(800)
        world.monitor.check(morning)
        assertEquals(800.0, world.gauge())
        world.provider.fail("invalid_response")
        val result = assertNotNull(world.monitor.check(morning))
        assertNull(result.credit)
        assertEquals(setOf(SmsBalanceRule.UNKNOWN), result.alerted)
        assertTrue(world.gauge().isNaN())
        assertTrue(
            world.mailer
                .sent()
                .single()
                .text
                .contains("reason=invalid_response"),
        )
        output.assertContains("SMS balance alert rule=unknown reason=invalid_response")
        world.monitor.check(morning)
        assertEquals(1, world.mailer.sent().size)
    }

    @Test
    fun `a failed mail is not marked as sent and the next run mails again`(output: CapturedOutput) {
        val world = World()
        world.provider.set(10)
        world.mailer.failNextSend("http_503")
        val failed = assertNotNull(world.monitor.check(morning))
        assertEquals(1, failed.mailFailures)
        assertEquals(emptyList(), world.mailer.sent())
        output.assertContains("SMS balance alert mail outcome=failed rule=below_minimum reason=http_503")
        val retried = assertNotNull(world.monitor.check(morning.plusSeconds(60)))
        assertEquals(0, retried.mailFailures)
        assertEquals(1, world.mailer.sent().size)
        world.monitor.check(morning.plusSeconds(120))
        assertEquals(1, world.mailer.sent().size)
    }

    @Test
    fun `log and mail carry counts only, no phone number or recipient`(output: CapturedOutput) {
        val world = World(SmsBalanceAlertProperties(minCredit = 500, lastTopUp = 10_000, topUpPercent = 20))
        world.provider.set(5)
        world.monitor.check(morning)
        world.provider.fail("http_401")
        world.monitor.check(nextMorning)
        val text = world.mailer.sent().joinToString("\n") { it.subject + "\n" + it.text }
        val lines =
            output.all
                .lines()
                .filter { it.contains("SMS balance") }
                .joinToString("\n")
        assertEquals(3, lines.lines().size, lines)
        listOf(lines, text).forEach { content ->
            assertFalse(Regex("""\+?90?5\d{9}""").containsMatchIn(content), "a phone-shaped value was written")
            assertFalse(Regex("""[\w.-]+@[\w-]+\.[\w.]+""").containsMatchIn(content), "an address was written")
        }
    }

    @Test
    fun `the check runs under its job lock`() {
        val world = World()
        jobs.runExclusive(SmsBalanceMonitor.JOB_LOCK) {
            assertNull(world.monitor.check(morning))
        }
        assertNotNull(world.monitor.check(morning))
    }

    @Test
    fun `the context wires the fakes, the daily schedule and both meters`() {
        assertTrue(contextProvider is FakeSmsBalanceProvider)
        assertTrue(contextMailer is FakeAlertMailer)
        val method = SmsBalanceMonitor::class.java.getMethod("scheduled")
        val scheduled = assertNotNull(method.getAnnotation(Scheduled::class.java))
        assertEquals("0 0 9 * * *", scheduled.cron)
        assertEquals("Europe/Istanbul", scheduled.zone)
        assertNotNull(contextRegistry.find(SmsBalanceMonitor.BALANCE_GAUGE).gauge())
        (contextProvider as FakeSmsBalanceProvider).set(1)
        try {
            assertNotNull(contextMonitor.check(Instant.parse("2031-01-01T06:00:00Z")))
            assertEquals(1.0, contextRegistry.get(SmsBalanceMonitor.BALANCE_GAUGE).gauge().value())
            val counter = contextRegistry.find(SmsBalanceMonitor.ALERT_COUNTER).tag("rule", "below_minimum").counter()
            assertSame(counter, contextRegistry.get(SmsBalanceMonitor.ALERT_COUNTER).tag("rule", "below_minimum").counter())
            assertTrue(assertNotNull(counter).count() >= 1.0)
        } finally {
            contextProvider.set(1000)
        }
    }
}
