package app.cetele.android.feature.auth.otp

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.session.DeviceIdentity
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.domain.validation.Limits
import app.cetele.android.core.network.ApiConfig
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.AuthApi
import app.cetele.android.core.network.dto.auth.OtpVerifyBody
import app.cetele.android.core.network.dto.problem.ProblemCodes
import app.cetele.android.feature.auth.R
import app.cetele.android.feature.auth.common.AuthError
import app.cetele.android.feature.auth.common.OtpRequestResult
import app.cetele.android.feature.auth.common.OtpRequester
import app.cetele.android.feature.auth.common.authError
import app.cetele.android.feature.auth.common.retryDelaySeconds
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class OtpState(
    val phone: String,
    val loading: Boolean = false,
    val resendSeconds: Int = 60,
    val error: AuthError? = null,
    val destination: OtpDestination? = null,
    val attempt: Int = 0,
    val retrySeconds: Int = 0,
)

enum class OtpDestination { PinSetup, SignedIn }

@HiltViewModel
@Suppress("LongParameterList")
class OtpViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val api: AuthApi,
        private val identity: DeviceIdentity,
        private val session: SessionManager,
        private val settings: SettingsRepository,
        private val requester: OtpRequester,
        private val config: ApiConfig,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(OtpState(checkNotNull(savedStateHandle.get<String>("phone"))))
        val state = mutableState.asStateFlow()
        private var timer: Job? = null

        init {
            startTimer(RESEND_SECONDS)
        }

        fun submit(
            code: String,
            model: String,
        ) {
            if (state.value.loading || state.value.destination != null || state.value.retrySeconds > 0) return
            if (code.length != Limits.OTP_LENGTH || code.any { it !in '0'..'9' }) {
                mutableState.update { it.copy(error = AuthError(R.string.auth_otp_invalid)) }
                return
            }
            mutableState.update { it.copy(loading = true, error = null) }
            viewModelScope.launch {
                val body =
                    OtpVerifyBody(
                        state.value.phone,
                        identity.id(),
                        code,
                        model.take(Limits.MODEL_MAX),
                        config.appVersion.take(Limits.APP_VERSION_MAX),
                    )
                when (val result = api.verifyOtp(body)) {
                    is ApiResult.Success -> {
                        session.signIn(result.value, state.value.phone)
                        val pinReady = settings.current().pinSetupDone
                        val destination = if (pinReady) OtpDestination.SignedIn else OtpDestination.PinSetup
                        mutableState.update { it.copy(loading = false, destination = destination) }
                    }

                    is ApiResult.Failure -> {
                        val error =
                            if (result.problemCode == ProblemCodes.AUTH_OTP_INVALID) {
                                AuthError(R.string.auth_otp_invalid)
                            } else {
                                result.authError()
                            }
                        mutableState.update { it.copy(loading = false, error = error, attempt = it.attempt + 1) }
                        result.retryDelaySeconds()?.let { seconds ->
                            mutableState.update { it.copy(retrySeconds = seconds) }
                            startTimer(maxOf(seconds, state.value.resendSeconds))
                        }
                    }
                }
            }
        }

        fun resend() {
            if (state.value.loading || state.value.resendSeconds > 0 || state.value.destination != null) return
            mutableState.update { it.copy(loading = true, error = null) }
            viewModelScope.launch {
                when (val response = requester.request(state.value.phone)) {
                    OtpRequestResult.Unavailable -> {
                        mutableState.update {
                            it.copy(
                                loading = false,
                                error = AuthError(R.string.auth_phone_integrity_unavailable),
                            )
                        }
                    }

                    is OtpRequestResult.Response -> {
                        when (val result = response.result) {
                            is ApiResult.Success -> {
                                mutableState.update { it.copy(loading = false, attempt = it.attempt + 1) }
                                startTimer(RESEND_SECONDS)
                            }

                            is ApiResult.Failure -> {
                                mutableState.update { it.copy(loading = false, error = result.authError()) }
                                result.retryDelaySeconds()?.let(::startTimer)
                            }
                        }
                    }
                }
            }
        }

        private fun startTimer(seconds: Int) {
            timer?.cancel()
            mutableState.update { it.copy(resendSeconds = seconds) }
            timer =
                viewModelScope.launch {
                    while (state.value.resendSeconds > 0) {
                        delay(SECOND_MILLIS)
                        mutableState.update {
                            it.copy(
                                resendSeconds = (it.resendSeconds - 1).coerceAtLeast(0),
                                retrySeconds =
                                    (
                                        it.retrySeconds -
                                            1
                                    ).coerceAtLeast(0),
                            )
                        }
                    }
                }
        }

        private companion object {
            const val RESEND_SECONDS = 60
            const val SECOND_MILLIS = 1000L
        }
    }
