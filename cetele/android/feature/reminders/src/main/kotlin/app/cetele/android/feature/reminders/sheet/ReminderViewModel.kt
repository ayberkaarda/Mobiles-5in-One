package app.cetele.android.feature.reminders.sheet

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import app.cetele.android.core.data.repository.CustomerRepository
import app.cetele.android.core.data.repository.ReminderLogRepository
import app.cetele.android.core.data.repository.ReminderRecord
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.designsystem.copy.ProblemCodeText
import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.RemindersApi
import app.cetele.android.core.network.api.StatementsApi
import app.cetele.android.core.network.dto.reminders.ReminderRequest
import app.cetele.android.core.network.dto.statements.StatementLinkRequest
import app.cetele.android.feature.reminders.R
import app.cetele.android.feature.reminders.ReminderTemplates
import app.cetele.android.feature.reminders.navigation.ReminderRoutes
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Clock
import javax.inject.Inject

@HiltViewModel
@Suppress("LongParameterList") // Constructor dependencies keep the feature's API and local storage contracts explicit.
class ReminderViewModel internal constructor(
    private val customerId: String,
    private val customers: CustomerRepository,
    private val shops: ShopRepository,
    private val logs: ReminderLogRepository,
    private val statements: StatementsApi,
    private val reminders: RemindersApi,
    private val clock: Clock,
) : ViewModel() {
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        customers: CustomerRepository,
        shops: ShopRepository,
        logs: ReminderLogRepository,
        statements: StatementsApi,
        reminders: RemindersApi,
        clock: Clock,
    ) : this(
        savedStateHandle.toRoute<ReminderRoutes.Sheet>().customerId,
        customers,
        shops,
        logs,
        statements,
        reminders,
        clock,
    )

    private val mutableState = MutableStateFlow(ReminderState())
    val state = mutableState.asStateFlow()
    private val shares = Channel<String>(Channel.BUFFERED)
    val shareRequests = shares.receiveAsFlow()
    private var pendingShare: Pair<String, String>? = null

    init {
        viewModelScope.launch {
            shops.observeActive().distinctUntilChanged().collectLatest { shop ->
                mutableState.value = ReminderState(shop = shop)
                pendingShare = null
                if (shop != null) {
                    combine(
                        customers.observe(shop.id, customerId),
                        customers.observeBalance(shop.id, customerId),
                        logs.observeLast(shop.id, customerId),
                    ) { customer, balance, last ->
                        Triple(customer, balance, last)
                    }.collect { (customer, balance, last) ->
                        mutableState.update {
                            it.copy(customer = customer, balanceMinor = balance.minor, lastReminder = last)
                        }
                    }
                }
            }
        }
    }

    fun sendWhatsApp() {
        val snapshot = state.value
        val target = begin(snapshot, snapshot.whatsappDisabledReason) ?: return
        val (shop, customer) = target
        viewModelScope.launch {
            when (val result = statements.createLink(shop.id, StatementLinkRequest(customer.id))) {
                is ApiResult.Success -> {
                    if (state.value.shop?.id == shop.id) {
                        pendingShare = shop.id to customer.id
                        shares.send(
                            ReminderTemplates.whatsapp(
                                customer.name,
                                shop.name,
                                snapshot.balanceMinor,
                                result.value.url,
                            ),
                        )
                    }
                }

                is ApiResult.Failure -> {
                    if (state.value.shop?.id == shop.id) showFailure(result)
                }
            }
            if (pendingShare == null && state.value.shop?.id == shop.id) {
                mutableState.update { it.copy(busy = false) }
            }
        }
    }

    fun shareFinished(opened: Boolean) {
        val target = pendingShare ?: return
        pendingShare = null
        viewModelScope.launch {
            if (opened) {
                logs.record(target.first, target.second, ReminderRecord("WHATSAPP", clock.instant(), "SHARED"))
            }
            if (state.value.shop?.id == target.first) {
                mutableState.update {
                    it.copy(busy = false, message = if (opened) null else R.string.reminders_sheet_share_failed)
                }
            }
        }
    }

    fun sendSms() {
        val snapshot = state.value
        val target = begin(snapshot, snapshot.smsDisabledReason) ?: return
        val (shop, customer) = target
        viewModelScope.launch {
            when (val result = reminders.send(shop.id, ReminderRequest(customer.id))) {
                is ApiResult.Success -> {
                    val response = result.value
                    logs.record(
                        shop.id,
                        customer.id,
                        ReminderRecord(
                            "SMS",
                            response.sentAt,
                            response.status,
                            response.quota.used,
                            response.quota.limit,
                        ),
                    )
                    if (state.value.shop?.id == shop.id) {
                        mutableState.update {
                            it.copy(
                                quota = response.quota,
                                message = R.string.reminders_sheet_sms_sent,
                            )
                        }
                    }
                }

                is ApiResult.Failure -> {
                    if (state.value.shop?.id == shop.id) showFailure(result)
                }
            }
            if (state.value.shop?.id == shop.id) mutableState.update { it.copy(busy = false) }
        }
    }

    private fun begin(
        snapshot: ReminderState,
        disabledReason: Int?,
    ): Pair<Shop, Customer>? {
        val shop = snapshot.shop
        val customer = snapshot.customer
        val allowed = disabledReason == null && canSend(snapshot) && shop != null && customer != null
        if (!allowed) return null
        mutableState.update { it.copy(busy = true, message = null, traceId = null) }
        return requireNotNull(shop) to requireNotNull(customer)
    }

    private fun canSend(snapshot: ReminderState): Boolean = !snapshot.busy && clock.millis() >= snapshot.retryAtMillis

    private fun showFailure(failure: ApiResult.Failure) {
        val problem = failure as? ApiResult.Failure.Problem
        val uncertain =
            problem?.problem?.code == "sms.provider_failed" ||
                (failure is ApiResult.Failure.Unexpected && failure.status == HTTP_BAD_GATEWAY)
        val seconds = problem?.retryAfterSeconds?.coerceAtLeast(0)
        mutableState.update {
            it.copy(
                message =
                    if (uncertain) {
                        R.string.reminders_sheet_provider_failed
                    } else {
                        ProblemCodeText.resIdOrGeneric(problem?.problem?.code)
                    },
                traceId = problem?.problem?.traceId,
                retrySeconds = seconds,
                retryAtMillis = seconds?.let { delay -> clock.millis() + delay.toLong() * MILLIS_PER_SECOND } ?: 0,
                smsUncertain = it.smsUncertain || uncertain,
            )
        }
    }

    private companion object {
        const val HTTP_BAD_GATEWAY = 502
        const val MILLIS_PER_SECOND = 1000
    }
}
