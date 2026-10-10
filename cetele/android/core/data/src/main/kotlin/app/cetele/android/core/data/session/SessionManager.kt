package app.cetele.android.core.data.session

import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.lock.LockController
import app.cetele.android.core.data.media.EncryptedPhotoStore
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.sync.RetryAfterPolicy
import app.cetele.android.core.data.vault.Vault
import app.cetele.android.core.data.vault.VaultKeys
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.auth.AccessTokenHolder
import app.cetele.android.core.network.auth.TokenRefresher
import app.cetele.android.core.network.dto.auth.RefreshBody
import app.cetele.android.core.network.dto.auth.SignInResponse
import app.cetele.android.core.network.dto.auth.TokenResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Provider
import javax.inject.Singleton

enum class SignOutReason { USER, REFRESH_INVALID, ACCOUNT_DELETED, MEMBERSHIP_LOST }

sealed interface SessionState {
    data class SignedOut(
        val reason: SignOutReason? = null,
    ) : SessionState

    data class SignedIn(
        val userId: String,
        val phone: String,
    ) : SessionState
}

sealed interface SessionEvent {
    data class SignedOut(
        val reason: SignOutReason,
    ) : SessionEvent
}

interface SessionWork {
    suspend fun cancelAll()
}

sealed interface SignOutCheck {
    data object Ready : SignOutCheck

    data class Pending(
        val count: Int,
    ) : SignOutCheck
}

@Singleton
@Suppress("LongParameterList")
class SessionManager
    @Inject
    constructor(
        private val auth: Provider<AuthApi>,
        private val tokens: AccessTokenHolder,
        private val vault: Vault,
        private val databases: DatabaseStore,
        private val photos: EncryptedPhotoStore,
        private val settings: SettingsRepository,
        private val work: SessionWork,
        private val lock: LockController,
        // Optional only to keep the earlier constructor shape; the injected graph always provides it.
        private val retryAfter: RetryAfterPolicy? = null,
    ) : TokenRefresher {
        private companion object {
            const val EVENT_CAPACITY = 8
            const val UNAUTHORIZED = 401
        }

        private val mutex = Mutex()
        private val signingOut = AtomicBoolean(false)
        private val mutableState = MutableStateFlow<SessionState>(restoredState())
        val state = mutableState.asStateFlow()
        private val mutableEvents = MutableSharedFlow<SessionEvent>(extraBufferCapacity = EVENT_CAPACITY)
        val events = mutableEvents.asSharedFlow()

        private fun restoredState(): SessionState {
            val id = vault.get(VaultKeys.USER_ID)?.toString(Charsets.UTF_8)
            val phone = vault.get(VaultKeys.PHONE)?.toString(Charsets.UTF_8)
            return if (id != null && phone != null &&
                vault.get(VaultKeys.REFRESH_TOKEN) != null
            ) {
                SessionState.SignedIn(id, phone)
            } else {
                SessionState.SignedOut()
            }
        }

        suspend fun signIn(
            response: SignInResponse,
            phone: String,
        ) = mutex.withLock {
            check(!signingOut.get()) { "Sign-out is in progress" }
            vault.put(VaultKeys.REFRESH_TOKEN, response.refreshToken.toByteArray(Charsets.UTF_8))
            vault.put(VaultKeys.USER_ID, response.user.id.toByteArray(Charsets.UTF_8))
            vault.put(VaultKeys.PHONE, phone.toByteArray(Charsets.UTF_8))
            tokens.accessToken = response.accessToken
            mutableState.value = SessionState.SignedIn(response.user.id, phone)
        }

        suspend fun checkSignOut(): SignOutCheck {
            if (state.value is SessionState.SignedOut) return SignOutCheck.Ready
            val rows = databases.get().shopDao().all()
            val count = rows.sumOf { databases.get().outboxDao().countPending(it.id) }
            return if (count > 0) SignOutCheck.Pending(count) else SignOutCheck.Ready
        }

        suspend fun signOut(reason: SignOutReason) {
            if (state.value is SessionState.SignedOut || !signingOut.compareAndSet(false, true)) return
            try {
                // A dead refresh family has nothing left to revoke; calling logout would only trigger another refresh.
                if (reason != SignOutReason.REFRESH_INVALID) revokeRemotely()
            } finally {
                try {
                    withContext(NonCancellable) { mutex.withLock { wipe(reason) } }
                } finally {
                    signingOut.set(false)
                }
            }
        }

        @Suppress("TooGenericExceptionCaught", "SwallowedException")
        private suspend fun revokeRemotely() {
            try {
                auth.get().logout()
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                // Remote revocation is best effort; local cleanup remains required.
            }
        }

        @Suppress("TooGenericExceptionCaught")
        private suspend fun wipe(reason: SignOutReason) {
            val actions: List<suspend () -> Unit> =
                listOf(
                    { work.cancelAll() },
                    { tokens.clear() },
                    { databases.wipe() },
                    { photos.clear() },
                    { vault.clear() },
                    { settings.clearSession() },
                    { lock.reset() },
                    { retryAfter?.clear() },
                )
            var failure: Exception? = null
            for (action in actions) {
                try {
                    action()
                } catch (exception: Exception) {
                    if (failure == null) failure = exception else failure.addSuppressed(exception)
                }
            }
            mutableState.value = SessionState.SignedOut(reason)
            mutableEvents.emit(SessionEvent.SignedOut(reason))
            failure?.let { throw it }
        }

        override suspend fun refresh(): ApiResult<TokenResponse> =
            mutex.withLock {
                val refresh =
                    vault.get(VaultKeys.REFRESH_TOKEN)?.toString(Charsets.UTF_8)
                        ?: return@withLock ApiResult.Failure.Unexpected(UNAUTHORIZED)
                val result = auth.get().refresh(RefreshBody(refresh))
                if (result is ApiResult.Success) {
                    vault.put(
                        VaultKeys.REFRESH_TOKEN,
                        result.value.refreshToken.toByteArray(Charsets.UTF_8),
                    )
                }
                result
            }

        override suspend fun onRefreshInvalid() {
            signOut(SignOutReason.REFRESH_INVALID)
        }

        suspend fun onMembershipLost(shopId: String) {
            if (settings.current().activeShopId == shopId) signOut(SignOutReason.MEMBERSHIP_LOST)
        }
    }
