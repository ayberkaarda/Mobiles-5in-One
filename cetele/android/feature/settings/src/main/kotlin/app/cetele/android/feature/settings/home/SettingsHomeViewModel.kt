package app.cetele.android.feature.settings.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.data.repository.SyncIssueRepository
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.session.SignOutCheck
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.ThemeMode
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.MeApi
import app.cetele.android.core.network.dto.me.DeletionStatus
import app.cetele.android.feature.settings.common.SettingsError
import app.cetele.android.feature.settings.common.error
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsHomeState(
    val shop: Shop? = null,
    val deletion: DeletionStatus? = null,
    val pending: Int = 0,
    val lastSync: String? = null,
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val signOutPending: Int? = null,
    val signOutConfirmation: Boolean = false,
    val busy: Boolean = false,
    val error: SettingsError? = null,
)

@HiltViewModel
class SettingsHomeViewModel
    @Inject
    constructor(
        private val shops: ShopRepository,
        private val settings: SettingsRepository,
        private val me: MeApi,
        private val session: SessionManager,
        private val syncIssues: SyncIssueRepository,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(SettingsHomeState())
        val state = mutableState.asStateFlow()

        init {
            viewModelScope.launch {
                shops.observeActive().collectLatest { shop ->
                    mutableState.value = state.value.copy(shop = shop, pending = 0, lastSync = null)
                    shop?.let { active ->
                        syncIssues.observeStatus(active.id).collect { status ->
                            mutableState.value =
                                state.value.copy(
                                    pending = status.pendingCount,
                                    lastSync = status.lastPullAt?.toString(),
                                )
                        }
                    }
                }
            }
            viewModelScope.launch { shops.deletion.collect { mutableState.value = state.value.copy(deletion = it) } }
            viewModelScope.launch {
                settings.settings.collect {
                    mutableState.value =
                        state.value.copy(
                            theme = it.themeMode,
                        )
                }
            }
        }

        fun refresh() =
            viewModelScope.launch {
                if (state.value.busy) return@launch
                mutableState.value = state.value.copy(busy = true, error = null)
                val result = shops.refresh()
                mutableState.value = state.value.copy(busy = false, error = result.error())
            }

        fun cancelDeletion() =
            viewModelScope.launch {
                if (state.value.busy) return@launch
                mutableState.value = state.value.copy(busy = true, error = null)
                when (val result = me.cancelDeletion()) {
                    is ApiResult.Success -> {
                        mutableState.value = state.value.copy(deletion = null)
                        mutableState.value = state.value.copy(error = shops.refresh().error())
                    }

                    is ApiResult.Failure -> {
                        mutableState.value = state.value.copy(error = result.error())
                    }
                }
                mutableState.value = state.value.copy(busy = false)
            }

        fun theme(mode: ThemeMode) = viewModelScope.launch { settings.update { it.copy(themeMode = mode) } }

        fun requestSignOut() {
            mutableState.value = state.value.copy(signOutConfirmation = true, signOutPending = null)
        }

        fun dismissSignOut() {
            mutableState.value = state.value.copy(signOutConfirmation = false, signOutPending = null)
        }

        fun confirmSignOut() =
            viewModelScope.launch {
                if (state.value.busy || !state.value.signOutConfirmation) return@launch
                mutableState.value = state.value.copy(busy = true)
                when (val check = session.checkSignOut()) {
                    SignOutCheck.Ready -> {
                        session.signOut(SignOutReason.USER)
                    }

                    is SignOutCheck.Pending -> {
                        if (state.value.signOutPending == check.count) {
                            session.signOut(SignOutReason.USER)
                        } else {
                            mutableState.value = state.value.copy(signOutPending = check.count)
                        }
                    }
                }
                mutableState.value = state.value.copy(busy = false)
            }
    }
