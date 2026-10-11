package app.cetele.android.feature.settings.devices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.api.DeviceSession
import app.cetele.android.core.network.api.DeviceSignOutBody
import app.cetele.android.core.network.api.DevicesApi
import app.cetele.android.core.network.api.ReauthAction
import app.cetele.android.feature.settings.account.validCode
import app.cetele.android.feature.settings.common.SettingsError
import app.cetele.android.feature.settings.common.error
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DevicesState(
    val devices: List<DeviceSession> = emptyList(),
    val selectedId: String? = null,
    val busy: Boolean = false,
    val codeSent: Boolean = false,
    val error: SettingsError? = null,
)

@HiltViewModel
class DevicesViewModel
    @Inject
    constructor(
        private val api: DevicesApi,
        private val auth: AuthApi,
        private val session: SessionManager,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(DevicesState())
        val state = mutableState.asStateFlow()

        fun load() =
            viewModelScope.launch {
                if (state.value.busy) return@launch
                mutableState.value = state.value.copy(busy = true, error = null)
                refresh()
                mutableState.value = state.value.copy(busy = false)
            }

        private suspend fun refresh() {
            when (val result = api.list()) {
                is ApiResult.Success -> mutableState.value = state.value.copy(devices = result.value, error = null)
                is ApiResult.Failure -> mutableState.value = state.value.copy(error = result.error())
            }
        }

        fun select(id: String) {
            if (state.value.busy || state.value.devices.none { it.id == id && it.signedIn }) return
            mutableState.value = state.value.copy(selectedId = id, codeSent = false, error = null)
        }

        fun dismiss() {
            if (!state.value.busy) mutableState.value = state.value.copy(selectedId = null, codeSent = false)
        }

        fun requestCode() =
            viewModelScope.launch {
                if (state.value.busy || state.value.selectedId == null) return@launch
                mutableState.value = state.value.copy(busy = true, error = null)
                val result = auth.requestReauth(ReauthAction.DEVICE_SIGN_OUT)
                mutableState.value =
                    state.value.copy(busy = false, codeSent = result is ApiResult.Success, error = result.error())
            }

        fun signOut(code: String) =
            viewModelScope.launch {
                val device =
                    state.value.devices.find { it.id == state.value.selectedId && it.signedIn } ?: return@launch
                if (state.value.busy || !state.value.codeSent) return@launch
                if (!validCode(code)) {
                    mutableState.value = state.value.copy(error = SettingsError("auth.reauth_invalid"))
                    return@launch
                }
                mutableState.value = state.value.copy(busy = true, error = null)
                when (val result = api.signOut(device.id, DeviceSignOutBody(code))) {
                    is ApiResult.Success -> {
                        mutableState.value = state.value.copy(selectedId = null, codeSent = false)
                        if (device.current) session.signOut(SignOutReason.USER) else refresh()
                    }

                    is ApiResult.Failure -> {
                        mutableState.value = state.value.copy(error = result.error())
                    }
                }
                mutableState.value = state.value.copy(busy = false)
            }
    }
