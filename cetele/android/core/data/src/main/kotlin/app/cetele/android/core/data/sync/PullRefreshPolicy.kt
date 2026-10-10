package app.cetele.android.core.data.sync

import java.time.Duration
import java.time.Instant

object PullRefreshPolicy {
    private const val MAX_AGE_SECONDS = 60L

    fun shouldRefresh(
        lastPullAt: Instant?,
        now: Instant,
    ): Boolean = lastPullAt == null || Duration.between(lastPullAt, now).seconds > MAX_AGE_SECONDS
}
