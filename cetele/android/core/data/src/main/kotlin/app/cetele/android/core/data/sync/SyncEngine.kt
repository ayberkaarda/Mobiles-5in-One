package app.cetele.android.core.data.sync

import android.util.Log
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.SyncApi
import app.cetele.android.core.network.dto.sync.PushRequest
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

sealed interface SyncOutcome {
    data class Done(
        val pushed: Int,
        val pulled: Int,
    ) : SyncOutcome

    data class RetryAfter(
        val seconds: Int,
    ) : SyncOutcome

    data class Blocked(
        val code: String,
    ) : SyncOutcome

    data object Unauthorized : SyncOutcome

    data object Offline : SyncOutcome
}

fun interface SyncLogger {
    fun completed(
        shopId: String,
        outcome: SyncOutcome,
    )
}

@Singleton
class SyncEngine(
    private val store: SyncLocalStore,
    private val api: SyncApi,
    private val builder: PushBatchBuilder,
    private val applier: PullApplier,
    private val rejections: RejectionHandler,
    private val logger: SyncLogger,
) {
    @Inject
    constructor(
        store: SyncLocalStore,
        api: SyncApi,
        builder: PushBatchBuilder,
        applier: PullApplier,
        rejections: RejectionHandler,
    ) : this(
        store,
        api,
        builder,
        applier,
        rejections,
        SyncLogger { id, outcome ->
            val summary =
                when (outcome) {
                    is SyncOutcome.Done -> "done pushed=${outcome.pushed} pulled=${outcome.pulled}"
                    is SyncOutcome.RetryAfter -> "deferred"
                    is SyncOutcome.Blocked -> "blocked"
                    SyncOutcome.Unauthorized -> "unauthorized"
                    SyncOutcome.Offline -> "offline"
                }
            Log.d("CeteleSync", "shop=$id $summary")
        },
    )

    private val locks = ConcurrentHashMap<String, Mutex>()

    suspend fun sync(shopId: String): SyncOutcome =
        locks.getOrPut(shopId) { Mutex() }.withLock {
            val outcome = synchronize(shopId)
            if (outcome != SyncOutcome.Unauthorized) {
                store.recordError(shopId, (outcome as? SyncOutcome.Blocked)?.code, outcome == SyncOutcome.Offline)
            }
            logger.completed(shopId, outcome)
            outcome
        }

    private suspend fun synchronize(shopId: String): SyncOutcome {
        val batch = builder.build(shopId)
        val stopped = if (batch.operations.isEmpty()) null else push(shopId, batch)
        return stopped ?: when (val response = applier.pull(shopId)) {
            is ApiResult.Success -> SyncOutcome.Done(batch.operations.size, response.value)
            is ApiResult.Failure -> response.outcome()
        }
    }

    /** Null when the server answered every operation; otherwise the outcome that ends this run. */
    private suspend fun push(
        shopId: String,
        batch: PushRequest,
    ): SyncOutcome? =
        when (val response = api.push(shopId, batch)) {
            is ApiResult.Success -> {
                val expected = batch.operations.map { it.clientId }
                val actual = response.value.results.map { it.clientId }
                if (actual.size != expected.size || actual.toSet() != expected.toSet()) {
                    SyncOutcome.Offline
                } else {
                    rejections.apply(shopId, response.value.results, response.value.head)
                    null
                }
            }

            is ApiResult.Failure -> {
                val status =
                    when (response) {
                        is ApiResult.Failure.Problem -> response.problem.status
                        is ApiResult.Failure.Unexpected -> response.status
                        is ApiResult.Failure.Network -> null
                    }
                if (status == UNPROCESSABLE) {
                    rejections.blockBatch(shopId, batch.operations.map { it.clientId })
                    SyncOutcome.Blocked(VALIDATION_FAILED)
                } else {
                    response.outcome()
                }
            }
        }

    private companion object {
        const val UNPROCESSABLE = 422
        const val VALIDATION_FAILED = "validation.failed"
    }
}

internal fun ApiResult.Failure.outcome(): SyncOutcome =
    when (this) {
        is ApiResult.Failure.Network -> {
            SyncOutcome.Offline
        }

        is ApiResult.Failure.Unexpected -> {
            if (status ==
                SyncHttpStatus.UNAUTHORIZED
            ) {
                SyncOutcome.Unauthorized
            } else {
                SyncOutcome.Offline
            }
        }

        is ApiResult.Failure.Problem -> {
            when {
                problem.status == SyncHttpStatus.UNAUTHORIZED -> {
                    SyncOutcome.Unauthorized
                }

                problem.status == SyncHttpStatus.RATE_LIMITED -> {
                    SyncOutcome.RetryAfter(
                        (
                            retryAfterSeconds
                                ?: SyncHttpStatus.DEFAULT_RETRY_SECONDS
                        ).coerceAtLeast(1),
                    )
                }

                problem.status >= SyncHttpStatus.SERVER_ERROR -> {
                    SyncOutcome.Offline
                }

                else -> {
                    SyncOutcome.Blocked(problem.code ?: "conflict")
                }
            }
        }
    }

private object SyncHttpStatus {
    const val UNAUTHORIZED = 401
    const val RATE_LIMITED = 429
    const val SERVER_ERROR = 500
    const val DEFAULT_RETRY_SECONDS = 30
}
