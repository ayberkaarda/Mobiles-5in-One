package app.cetele.server.monitoring

import app.cetele.server.config.CeteleTime
import app.cetele.server.config.JobLocks
import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.Gauge
import io.micrometer.core.instrument.MeterRegistry
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Instant
import java.time.LocalDate

/** The conditions that raise an SMS balance alert. [tag] is the metric tag and the log value. */
enum class SmsBalanceRule(
    val tag: String,
) {
    /** Credit below `CETELE_SMS_BALANCE_MIN_CREDIT`. */
    BELOW_MINIMUM("below_minimum"),

    /** Credit below `CETELE_SMS_BALANCE_TOP_UP_PERCENT` (20) percent of the last known top-up. */
    BELOW_TOP_UP_SHARE("below_top_up_share"),

    /** The provider answer could not be read; the credit is not known. */
    UNKNOWN("unknown"),
}

/** What one check found, for the log and the tests. */
data class SmsBalanceCheck(
    val credit: Long?,
    val breached: Set<SmsBalanceRule>,
    val alerted: Set<SmsBalanceRule>,
    val mailFailures: Int,
)

/**
 * Daily SMS credit check (spec item 22), at 09:00 Europe/Istanbul under the `sms-balance-monitor`
 * job lock and behind `CETELE_JOBS_ENABLED`. Each breached [SmsBalanceRule] is logged and mailed
 * at most once per Istanbul day (a rule still breached the next day alerts again that day); a failed
 * mail is logged at ERROR and not marked as sent, so the next run mails it again. Gauge
 * `cetele.sms.balance` (NaN while unknown) and counter `cetele.sms.balance.alert` (tag `rule`)
 * appear in Prometheus format as `cetele_sms_balance` and `cetele_sms_balance_alert_total`.
 *
 * The top-up reference is the credit seen right after the monitor saw it rise, otherwise
 * `CETELE_SMS_BALANCE_LAST_TOP_UP`. State is per process: a restart forgets which alerts went out
 * today and the observed top-up.
 */
@Component
class SmsBalanceMonitor(
    private val provider: SmsBalanceProvider,
    private val mailer: AlertMailer,
    private val properties: SmsBalanceAlertProperties,
    private val jobs: JobLocks,
    private val clock: Clock,
    private val registry: MeterRegistry,
) {
    private val log = LoggerFactory.getLogger(SmsBalanceMonitor::class.java)
    private val lock = Any()
    private var lastCredit: Long? = null
    private var observedTopUp: Long? = null
    private val alertedOn = mutableMapOf<SmsBalanceRule, LocalDate>()

    @Volatile
    private var gaugeValue: Double = Double.NaN

    init {
        Gauge
            .builder(BALANCE_GAUGE, this) { it.gaugeValue }
            .description("Remaining SMS credit of the provider account, NaN while unknown")
            .register(registry)
    }

    @Scheduled(cron = "0 0 9 * * *", zone = "Europe/Istanbul")
    fun scheduled() {
        check(clock.instant())
    }

    /** Returns `null` when another instance holds the job lock. */
    fun check(now: Instant): SmsBalanceCheck? {
        var result: SmsBalanceCheck? = null
        jobs.runExclusive(JOB_LOCK) { result = synchronized(lock) { evaluate(now) } }
        return result
    }

    private fun evaluate(now: Instant): SmsBalanceCheck {
        val today = now.atZone(CeteleTime.ZONE).toLocalDate()
        val reading = provider.read()
        val credit = (reading as? SmsBalanceReading.Known)?.credit
        val breached = mutableSetOf<SmsBalanceRule>()
        var reference: Long? = null
        if (credit == null) {
            gaugeValue = Double.NaN
            breached += SmsBalanceRule.UNKNOWN
        } else {
            gaugeValue = credit.toDouble()
            val previous = lastCredit
            if (previous != null && credit > previous) observedTopUp = credit
            lastCredit = credit
            if (credit < properties.minCredit) breached += SmsBalanceRule.BELOW_MINIMUM
            reference = observedTopUp ?: properties.lastTopUp.takeIf { it > 0 }
            if (reference != null && credit.toDouble() * 100 < reference.toDouble() * properties.topUpPercent) {
                breached += SmsBalanceRule.BELOW_TOP_UP_SHARE
            }
        }
        val alerted = mutableSetOf<SmsBalanceRule>()
        var mailFailures = 0
        breached.filter { alertedOn[it] != today }.forEach { rule ->
            val detail = detail(rule, credit, reference, reading)
            log.warn("SMS balance alert rule={} {}", rule.tag, detail)
            Counter
                .builder(ALERT_COUNTER)
                .description("SMS balance alerts raised")
                .tag("rule", rule.tag)
                .register(registry)
                .increment()
            alerted += rule
            when (val sent = mailer.send(mail(rule, detail))) {
                AlertMailResult.Sent -> {
                    alertedOn[rule] = today
                }

                is AlertMailResult.Failed -> {
                    mailFailures++
                    log.error("SMS balance alert mail outcome=failed rule={} reason={}", rule.tag, sent.reason)
                }
            }
        }
        if (breached.isEmpty()) log.info("SMS balance outcome=ok credit={}", credit)
        return SmsBalanceCheck(credit, breached, alerted, mailFailures)
    }

    private fun detail(
        rule: SmsBalanceRule,
        credit: Long?,
        reference: Long?,
        reading: SmsBalanceReading,
    ): String =
        when (rule) {
            SmsBalanceRule.BELOW_MINIMUM -> "credit=$credit threshold=${properties.minCredit}"
            SmsBalanceRule.BELOW_TOP_UP_SHARE -> "credit=$credit topUp=$reference percent=${properties.topUpPercent}"
            SmsBalanceRule.UNKNOWN -> "reason=${(reading as? SmsBalanceReading.Unknown)?.reason}"
        }

    private fun mail(
        rule: SmsBalanceRule,
        detail: String,
    ): AlertMail {
        val subject =
            when (rule) {
                SmsBalanceRule.BELOW_MINIMUM -> "Cetele: SMS kredisi alt sınırın altında"
                SmsBalanceRule.BELOW_TOP_UP_SHARE -> "Cetele: SMS kredisi son yüklemenin yüzde ${properties.topUpPercent} altında"
                SmsBalanceRule.UNKNOWN -> "Cetele: SMS kredisi okunamadı"
            }
        val text =
            "$subject.\n\nKural: ${rule.tag}\n$detail\n\n" +
                "Yapılacaklar: docs/ops/cost-alerts.md, \"SMS provider balance\" bölümü."
        return AlertMail(subject, text)
    }

    companion object {
        const val JOB_LOCK = "sms-balance-monitor"
        const val BALANCE_GAUGE = "cetele.sms.balance"
        const val ALERT_COUNTER = "cetele.sms.balance.alert"
    }
}
