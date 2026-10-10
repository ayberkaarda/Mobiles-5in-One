package app.cetele.android.feature.billing.ui

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.BillingApi
import app.cetele.android.feature.billing.BillingProblemCodes
import app.cetele.android.feature.billing.ObfuscatedAccountId
import app.cetele.android.feature.billing.data.BillingOverview
import app.cetele.android.feature.billing.data.BillingStateMapper
import app.cetele.android.feature.billing.gateway.BillingGateway
import app.cetele.android.feature.billing.gateway.ProOffer
import app.cetele.android.feature.billing.gateway.PurchaseRequest
import app.cetele.android.feature.billing.gateway.StoreFailure
import app.cetele.android.feature.billing.gateway.StorePurchase
import app.cetele.android.feature.billing.gateway.StorePurchaseState
import app.cetele.android.feature.billing.gateway.StoreResult
import app.cetele.android.feature.billing.link.LinkOutcome
import app.cetele.android.feature.billing.link.PurchaseLinker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** A message shown once on the billing screen. */
sealed interface BillingNotice {
    data object Linked : BillingNotice

    data object Queued : BillingNotice

    data object StoreUnavailable : BillingNotice

    data object StoreError : BillingNotice

    data object NothingToRestore : BillingNotice

    data class Problem(
        val code: String?,
        val retryAfterSeconds: Int? = null,
    ) : BillingNotice
}

data class BillingUiState(
    val shop: Shop? = null,
    val loading: Boolean = false,
    val overview: BillingOverview? = null,
    val loadError: BillingNotice.Problem? = null,
    val offers: List<ProOffer> = emptyList(),
    val storeUnavailable: Boolean = false,
    val purchasing: Boolean = false,
    val restoring: Boolean = false,
    val pendingPayment: Boolean = false,
    val canSwitchPlan: Boolean = false,
    val notice: BillingNotice? = null,
) {
    val isOwner: Boolean get() = shop?.role == ShopRole.OWNER

    /** The owner buys when there is no subscription that gives PRO now; staff never sees the offers. */
    val showOffers: Boolean get() = isOwner && overview != null && !overview.entitled

    val showManage: Boolean get() = isOwner && overview?.entitled == true

    val busy: Boolean get() = loading || purchasing || restoring
}

@HiltViewModel
@Suppress("TooManyFunctions")
class BillingViewModel
    @Inject
    constructor(
        private val shops: ShopRepository,
        private val api: BillingApi,
        private val gateway: BillingGateway,
        private val linker: PurchaseLinker,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(BillingUiState())
        val state: StateFlow<BillingUiState> = mutableState.asStateFlow()

        /** The store purchase of the active shop, kept only for a base plan switch; never shown or logged. */
        private var currentPurchase: StorePurchase? = null

        init {
            viewModelScope.launch {
                shops.observeActive().collectLatest { shop ->
                    val previous = state.value.shop
                    if (shop?.id == previous?.id && shop?.role == previous?.role) {
                        mutableState.update { it.copy(shop = shop) }
                    } else {
                        currentPurchase = null
                        mutableState.value = BillingUiState(shop = shop)
                        if (shop != null) load(shop)
                    }
                }
            }
            viewModelScope.launch { gateway.purchaseUpdates.collect(::onPurchaseUpdate) }
        }

        /** Reloads plan and limits, and for an owner the offers and a restore of the store's purchases. */
        fun refresh() =
            viewModelScope.launch {
                val shop = state.value.shop ?: return@launch
                if (!state.value.busy) load(shop)
            }

        fun restore() =
            viewModelScope.launch {
                if (state.value.isOwner && !state.value.busy) restorePurchases(manual = true)
            }

        fun subscribe(
            activity: Activity,
            offer: ProOffer,
        ) = viewModelScope.launch {
            val current = state.value
            val shop = current.shop ?: return@launch
            if (!current.isOwner || current.busy || current.overview == null) return@launch
            val replacing = if (current.overview.entitled) currentPurchase?.purchaseToken else null
            if (current.overview.entitled && (replacing == null || !current.canSwitchPlan)) return@launch
            mutableState.update { it.copy(purchasing = true, notice = null) }
            when (val launched = gateway.launchPurchase(activity, PurchaseRequest(shop.id, offer, replacing))) {
                is StoreResult.Ok -> Unit
                is StoreResult.Failed -> onStoreFailure(launched.reason)
            }
        }

        fun dismissNotice() {
            mutableState.update { it.copy(notice = null) }
        }

        private suspend fun load(shop: Shop) {
            mutableState.update { it.copy(loading = true, loadError = null) }
            when (val result = api.state(shop.id)) {
                is ApiResult.Success -> {
                    mutableState.update { it.copy(overview = BillingStateMapper.map(result.value)) }
                }

                is ApiResult.Failure -> {
                    mutableState.update { it.copy(loadError = problem(result)) }
                }
            }
            if (shop.role == ShopRole.OWNER) {
                when (val offers = gateway.queryOffers()) {
                    is StoreResult.Ok -> {
                        mutableState.update { it.copy(offers = offers.value, storeUnavailable = false) }
                    }

                    is StoreResult.Failed -> {
                        mutableState.update { it.copy(offers = emptyList(), storeUnavailable = true) }
                    }
                }
                mutableState.update { it.copy(loading = false) }
                restorePurchases(manual = false)
            } else {
                mutableState.update { it.copy(loading = false) }
            }
        }

        private suspend fun restorePurchases(manual: Boolean) {
            val shopId = state.value.shop?.id ?: return
            mutableState.update { it.copy(restoring = true, notice = if (manual) null else it.notice) }
            val report = linker.restore()
            if (state.value.shop?.id != shopId) return
            report.purchases[shopId]?.let { currentPurchase = it }
            mutableState.update { it.copy(restoring = false, pendingPayment = shopId in report.pendingShops) }
            val outcome = report.outcomes[shopId]
            val notice =
                when {
                    outcome != null -> null
                    report.failure != null -> BillingNotice.StoreUnavailable
                    shopId in report.pendingShops -> null
                    else -> noticeWhenNothingLinked()
                }
            if (outcome != null) apply(shopId, outcome)
            if (manual && notice != null) mutableState.update { it.copy(notice = notice) }
            updateSwitch()
        }

        private suspend fun onPurchaseUpdate(update: StoreResult<List<StorePurchase>>) {
            when (update) {
                is StoreResult.Failed -> {
                    onStoreFailure(update.reason)
                }

                is StoreResult.Ok -> {
                    mutableState.update { it.copy(purchasing = false) }
                    val owned = linker.ownedShops()
                    for (purchase in update.value) handlePurchase(purchase, owned)
                    updateSwitch()
                }
            }
        }

        private suspend fun handlePurchase(
            purchase: StorePurchase,
            owned: Map<String, String>,
        ) {
            val shopId = PurchaseLinker.shopFor(purchase, owned) ?: return
            val active = shopId == state.value.shop?.id
            when (purchase.state) {
                StorePurchaseState.PENDING -> {
                    if (active) mutableState.update { it.copy(pendingPayment = true) }
                }

                StorePurchaseState.PURCHASED -> {
                    if (active) {
                        currentPurchase = purchase
                        mutableState.update { it.copy(pendingPayment = false, restoring = true) }
                    }
                    val outcome = linker.link(shopId, purchase)
                    if (active) {
                        mutableState.update { it.copy(restoring = false) }
                        apply(shopId, outcome)
                    }
                }

                StorePurchaseState.UNSPECIFIED -> {
                    return
                }
            }
        }

        private suspend fun apply(
            shopId: String,
            outcome: LinkOutcome,
        ) {
            when (outcome) {
                is LinkOutcome.Linked -> {
                    mutableState.update {
                        it.copy(overview = BillingStateMapper.map(outcome.state), notice = BillingNotice.Linked)
                    }
                }

                LinkOutcome.Queued -> {
                    mutableState.update { it.copy(notice = BillingNotice.Queued) }
                }

                is LinkOutcome.Refused -> {
                    mutableState.update { it.copy(notice = BillingNotice.Problem(outcome.code)) }
                    if (outcome.code == BillingProblemCodes.ALREADY_SUBSCRIBED) reloadState(shopId)
                }
            }
        }

        private suspend fun reloadState(shopId: String) {
            val result = api.state(shopId)
            if (result is ApiResult.Success && state.value.shop?.id == shopId) {
                mutableState.update { it.copy(overview = BillingStateMapper.map(result.value)) }
            }
        }

        private fun onStoreFailure(reason: StoreFailure) {
            val notice =
                when (reason) {
                    StoreFailure.CANCELED -> null

                    StoreFailure.UNAVAILABLE -> BillingNotice.StoreUnavailable

                    // The store account already owns Çetele Pro: the restore below links it instead.
                    StoreFailure.ALREADY_OWNED -> null

                    StoreFailure.ERROR -> BillingNotice.StoreError
                }
            mutableState.update { it.copy(purchasing = false, notice = notice) }
            if (reason == StoreFailure.ALREADY_OWNED) restore()
        }

        private fun noticeWhenNothingLinked(): BillingNotice? =
            if (state.value.overview?.entitled == true) null else BillingNotice.NothingToRestore

        private fun updateSwitch() {
            val shopId = state.value.shop?.id
            val purchase = currentPurchase
            val matches = shopId != null && purchase?.obfuscatedAccountId == ObfuscatedAccountId.of(shopId)
            mutableState.update { it.copy(canSwitchPlan = it.showManage && matches) }
        }

        private fun problem(failure: ApiResult.Failure): BillingNotice.Problem =
            when (failure) {
                is ApiResult.Failure.Problem -> BillingNotice.Problem(failure.problem.code, failure.retryAfterSeconds)
                else -> BillingNotice.Problem(null)
            }
    }
