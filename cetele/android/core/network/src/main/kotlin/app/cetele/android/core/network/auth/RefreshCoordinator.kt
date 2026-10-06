package app.cetele.android.core.network.auth

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.dto.auth.TokenResponse
import app.cetele.android.core.network.dto.problem.ProblemCodes
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

interface TokenRefresher {
    /** Rotates persisted refresh credentials; session cleanup belongs to onRefreshInvalid. */
    suspend fun refresh(): ApiResult<TokenResponse>

    suspend fun onRefreshInvalid()
}

sealed interface SessionEvent {
    data object RefreshInvalid : SessionEvent
}

class RefreshCoordinator(
    private val tokens: AccessTokenHolder,
    private val refresher: TokenRefresher,
) {
    private val mutex = Mutex()
    private var invalidated = false

    @Volatile
    private var refreshedToken: String? = null
    private val mutableEvents = MutableSharedFlow<SessionEvent>(extraBufferCapacity = 1)
    val events = mutableEvents.asSharedFlow()

    suspend fun refresh(rejectedToken: String?): String? {
        var notifyInvalid = false
        val token =
            mutex.withLock {
                val snapshot = tokens.snapshot()
                val current = snapshot.token
                if (current != null && current != rejectedToken) return@withLock current
                if (invalidated && current == null) return@withLock null
                invalidated = false
                when (val result = refresher.refresh()) {
                    is ApiResult.Success -> {
                        if (tokens.replace(snapshot, result.value.accessToken)) {
                            refreshedToken = result.value.accessToken
                            result.value.accessToken
                        } else {
                            tokens.accessToken
                        }
                    }

                    is ApiResult.Failure -> {
                        if (tokens.snapshot() == snapshot &&
                            result.isInvalidRefresh()
                        ) {
                            notifyInvalid = invalidateLocked()
                        }
                        null
                    }
                }
            }
        if (notifyInvalid) notifySession()
        return token
    }

    /**
     * Sees every API response with the bearer it carried. A `401` for an access token that was just
     * issued by a refresh and has not been accepted yet ends the session; once the server accepts a
     * refreshed token, its later natural expiry goes through the ordinary refresh path again.
     */
    suspend fun onResponse(
        token: String?,
        status: Int,
    ) {
        if (token == null || token != refreshedToken) return
        if (status != HTTP_UNAUTHORIZED) {
            mutex.withLock { if (refreshedToken == token) refreshedToken = null }
            return
        }
        val notifyInvalid =
            mutex.withLock {
                if (token == refreshedToken && token == tokens.accessToken) invalidateLocked() else false
            }
        if (notifyInvalid) notifySession()
    }

    private fun invalidateLocked(): Boolean {
        if (invalidated) return false
        invalidated = true
        refreshedToken = null
        tokens.clear()
        return true
    }

    private suspend fun notifySession() {
        mutableEvents.emit(SessionEvent.RefreshInvalid)
        refresher.onRefreshInvalid()
    }

    private fun ApiResult.Failure.isInvalidRefresh(): Boolean =
        when (this) {
            is ApiResult.Failure.Problem -> {
                problem.status == HTTP_UNAUTHORIZED || problem.code == ProblemCodes.AUTH_REFRESH_INVALID
            }

            is ApiResult.Failure.Unexpected -> {
                status == HTTP_UNAUTHORIZED
            }

            is ApiResult.Failure.Network -> {
                false
            }
        }

    private companion object {
        const val HTTP_UNAUTHORIZED = 401
    }
}
