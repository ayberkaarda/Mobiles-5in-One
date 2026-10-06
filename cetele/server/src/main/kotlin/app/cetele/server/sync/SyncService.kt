package app.cetele.server.sync

import app.cetele.server.auth.ratelimit.RateLimit
import app.cetele.server.auth.ratelimit.RateLimiter
import app.cetele.server.security.CurrentUser
import app.cetele.server.sync.apply.OperationApplier
import app.cetele.server.sync.changelog.ChangeLogReader
import app.cetele.server.sync.changelog.ShopSequence
import app.cetele.server.tenancy.MembershipResolver
import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import app.cetele.server.web.problem.ProblemFieldError
import org.slf4j.LoggerFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import java.util.UUID

@Service
class SyncService(
    private val applier: OperationApplier,
    private val sequence: ShopSequence,
    private val reader: ChangeLogReader,
    private val validation: SyncValidation,
    private val memberships: MembershipResolver,
    private val limiter: RateLimiter,
) {
    private val log = LoggerFactory.getLogger(SyncService::class.java)

    fun push(
        shopId: UUID,
        caller: CurrentUser,
        request: PushRequest,
    ): PushResponse {
        memberships.resolve(shopId, caller)
        limiter.consume(RateLimit.SYNC_PUSH_USER, caller.userId.toString())
        validation.batch(request)
        val results =
            request.operations.map { op ->
                try {
                    applier.apply(shopId, caller, op)
                } catch (problem: ProblemException) {
                    OperationResult(
                        op.clientId,
                        OperationStatus.REJECTED,
                        code = problem.code.code,
                        errors = problem.errors.takeIf { it.isNotEmpty() },
                    )
                } catch (_: DataIntegrityViolationException) {
                    OperationResult(op.clientId, OperationStatus.REJECTED, code = ProblemCode.CONFLICT.code)
                }
            }
        log.info(
            "Sync push shopId={} userId={} count={} rejected={}",
            shopId,
            caller.userId,
            results.size,
            results.count {
                it.status ==
                    OperationStatus.REJECTED
            },
        )
        return PushResponse(results, sequence.head(shopId))
    }

    fun pull(
        shopId: UUID,
        caller: CurrentUser,
        since: Long,
        limit: Int,
    ): PullResponse {
        memberships.resolve(shopId, caller)
        limiter.consume(RateLimit.SYNC_PULL_USER, caller.userId.toString())
        val errors = mutableListOf<ProblemFieldError>()
        if (since < 0) errors += ProblemFieldError("since", "out_of_range")
        if (limit !in 1..500) errors += ProblemFieldError("limit", "out_of_range")
        if (errors.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, errors = errors)
        val rows = reader.after(shopId, since, limit + 1)
        val page = rows.take(limit)
        log.info("Sync pull shopId={} userId={} count={}", shopId, caller.userId, page.size)
        return PullResponse(page, page.lastOrNull()?.seq ?: since, rows.size > limit)
    }
}
