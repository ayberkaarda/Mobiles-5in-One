package app.cetele.android.core.data.lock

object LockPolicy {
    private const val MILLIS_PER_SECOND = 1000L

    fun shouldLock(
        backgroundedAt: Long?,
        now: Long,
        timeoutSeconds: Int,
        coldStart: Boolean,
    ): Boolean {
        require(timeoutSeconds >= 0)
        return coldStart ||
            (backgroundedAt != null && now - backgroundedAt >= timeoutSeconds.toLong() * MILLIS_PER_SECOND)
    }
}
