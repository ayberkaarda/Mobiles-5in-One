package app.cetele.server.reminders.quota

import app.cetele.server.config.CeteleTime
import app.cetele.server.config.SmsLimitsProperties
import app.cetele.server.tenancy.PlanLimits
import app.cetele.server.tenancy.ShopLocks
import app.cetele.server.tenancy.shop.ShopPlan
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.util.UUID

data class QuotaState(
    val month: String,
    val used: Int,
    val limit: Int,
)

@Service
class SmsQuotaService(
    private val quotas: SmsQuotaRepository,
    private val locks: ShopLocks,
    private val sent: SmsSentRecordRepository,
    private val sentIndex: SmsSentIndex,
    private val limits: SmsLimitsProperties,
) {
    /** Joins the caller's queue transaction, so a failed queue insert also rolls back usage. */
    @Transactional
    fun reserve(
        shopId: UUID,
        plan: ShopPlan,
        now: Instant,
    ): QuotaState {
        locks.smsQuota(shopId)
        val month = now.atZone(CeteleTime.ZONE).toLocalDate().withDayOfMonth(1)
        val row = quotas.lockMonth(shopId, month) ?: SmsQuota(shopId, month)
        val limit = PlanLimits.of(plan).smsPerMonth
        if (row.used >= limit) {
            throw limited(ProblemCode.SMS_QUOTA_EXCEEDED, now, month.plusMonths(1))
        }
        row.used += 1
        quotas.save(row)
        return QuotaState(YearMonth.from(month).toString(), row.used, limit)
    }

    @Transactional
    fun refund(
        shopId: UUID,
        month: String,
    ) {
        refundMonth(shopId, YearMonth.parse(month).atDay(1))
    }

    @Transactional
    fun refund(
        shopId: UUID,
        month: LocalDate,
    ) {
        require(month.dayOfMonth == 1) { "quota month must start on the first day" }
        refundMonth(shopId, month)
    }

    private fun refundMonth(
        shopId: UUID,
        month: LocalDate,
    ) {
        locks.smsQuota(shopId)
        val row = quotas.lockMonth(shopId, month) ?: return
        row.used = (row.used - 1).coerceAtLeast(0)
        quotas.save(row)
    }

    /** SMS reminders that spent or may have spent provider credit today (Istanbul day, by request time). */
    @Transactional(readOnly = true)
    fun dailySent(now: Instant): Int {
        val day = now.atZone(CeteleTime.ZONE).toLocalDate()
        val start = day.atStartOfDay(CeteleTime.ZONE).toInstant()
        val end = day.plusDays(1).atStartOfDay(CeteleTime.ZONE).toInstant()
        val count = sentIndex.shopsRequestedBetween(start, end).sumOf { sent.countSpent(it, start, end) }
        return count.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }

    /**
     * Takes the global cap lock until the caller's transaction ends, then checks the cap. The caller inserts its
     * QUEUED row in that same transaction, so the next caller counts it and concurrent requests cannot all pass.
     */
    @Transactional
    fun reserveDailyCap(now: Instant) {
        locks.smsDailyCap()
        requireDailyCap(now)
    }

    @Transactional(readOnly = true)
    fun requireDailyCap(now: Instant) {
        if (dailySent(now) >= limits.dailyCap) {
            throw limited(ProblemCode.SMS_DAILY_CAP_REACHED, now, now.atZone(CeteleTime.ZONE).toLocalDate().plusDays(1))
        }
    }

    private fun limited(
        code: ProblemCode,
        now: Instant,
        nextDay: LocalDate,
    ): ProblemException {
        val remaining = Duration.between(now, nextDay.atStartOfDay(CeteleTime.ZONE).toInstant())
        val seconds = remaining.seconds + if (remaining.nano > 0) 1 else 0
        return ProblemException(code, headers = mapOf("Retry-After" to seconds.coerceAtLeast(1).toString()))
    }
}
