package app.cetele.android.feature.settings.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.domain.format.PhoneFormat
import app.cetele.android.core.domain.validation.Limits
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.MeApi
import app.cetele.android.core.network.dto.me.MePatchBody
import app.cetele.android.feature.settings.common.SettingsError
import app.cetele.android.feature.settings.common.error
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProfileState(
    val name: String = "",
    val phone: String = "",
    val busy: Boolean = false,
    val invalidName: Boolean = false,
    val saved: Boolean = false,
    val error: SettingsError? = null,
)

@HiltViewModel
class ProfileViewModel
    @Inject
    constructor(
        private val me: MeApi,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(ProfileState())
        val state = mutableState.asStateFlow()

        fun load() =
            viewModelScope.launch {
                if (state.value.busy) return@launch
                mutableState.value = state.value.copy(busy = true)
                when (val result = me.me()) {
                    is ApiResult.Success -> {
                        mutableState.value =
                            state.value.copy(
                                name = result.value.displayName.orEmpty(),
                                phone = PhoneFormat.masked(result.value.phone),
                                error = null,
                            )
                    }

                    is ApiResult.Failure -> {
                        mutableState.value = state.value.copy(error = result.error())
                    }
                }
                mutableState.value = state.value.copy(busy = false)
            }

        fun name(value: String) {
            if (!state.value.busy) {
                mutableState.value =
                    state.value.copy(name = value, saved = false, invalidName = false)
            }
        }

        fun save() =
            viewModelScope.launch {
                if (state.value.busy) return@launch
                val name = state.value.name.trim()
                if (name.length !in 1..Limits.DISPLAY_NAME_MAX) {
                    mutableState.value = state.value.copy(invalidName = true)
                    return@launch
                }
                mutableState.value = state.value.copy(busy = true, error = null)
                val result = me.patch(MePatchBody(name))
                mutableState.value =
                    state.value.copy(busy = false, saved = result is ApiResult.Success, error = result.error())
            }
    }
