package app.cetele.android.feature.auth.phone

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.domain.format.PhoneFormat
import app.cetele.android.core.network.ApiResult
import app.cetele.android.feature.auth.R
import app.cetele.android.feature.auth.common.AuthError
import app.cetele.android.feature.auth.common.OtpRequestResult
import app.cetele.android.feature.auth.common.OtpRequester
import app.cetele.android.feature.auth.common.authError
import app.cetele.android.feature.auth.common.retryDelaySeconds
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PhoneState(
    val phone: String = "",
    val loading: Boolean = false,
    val error: AuthError? = null,
    val retrySeconds: Int = 0,
    val requestedPhone: String? = null,
)

@HiltViewModel
class PhoneViewModel
    @Inject
    constructor(
        private val requester: OtpRequester,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(PhoneState())
        val state = mutableState.asStateFlow()

        fun edit(phone: String) {
            if (!state.value.loading) mutableState.update { it.copy(phone = phone, error = null) }
        }

        fun send() {
            if (state.value.loading || state.value.retrySeconds > 0 || state.value.requestedPhone != null) return
            val phone = PhoneFormat.toE164Tr(state.value.phone)
            if (phone == null) {
                mutableState.update { it.copy(error = AuthError(R.string.auth_phone_invalid)) }
                return
            }
            mutableState.update { it.copy(loading = true, error = null) }
            viewModelScope.launch {
                when (val response = requester.request(phone)) {
                    OtpRequestResult.Unavailable -> {
                        mutableState.update {
                            it.copy(loading = false, error = AuthError(R.string.auth_phone_integrity_unavailable))
                        }
                    }

                    is OtpRequestResult.Response -> {
                        accept(response.result, phone)
                    }
                }
            }
        }

        private fun accept(
            result: ApiResult<Unit>,
            phone: String,
        ) {
            when (result) {
                is ApiResult.Success -> {
                    mutableState.update { it.copy(loading = false, requestedPhone = phone) }
                }

                is ApiResult.Failure -> {
                    val seconds = result.retryDelaySeconds() ?: 0
                    mutableState.update { it.copy(loading = false, error = result.authError(), retrySeconds = seconds) }
                    if (seconds > 0) {
                        viewModelScope.launch {
                            while (state.value.retrySeconds > 0) {
                                delay(SECOND_MILLIS)
                                mutableState.update { it.copy(retrySeconds = (it.retrySeconds - 1).coerceAtLeast(0)) }
                            }
                        }
                    }
                }
            }
        }

        fun navigationHandled() {
            mutableState.update { it.copy(requestedPhone = null) }
        }

        private companion object {
            const val SECOND_MILLIS = 1000L
        }
    }
