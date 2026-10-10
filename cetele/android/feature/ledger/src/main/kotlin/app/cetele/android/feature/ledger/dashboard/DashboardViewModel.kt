package app.cetele.android.feature.ledger.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.DashboardRepository
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.ledger.DashboardSummary
import app.cetele.android.core.domain.time.CeteleClock
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Clock
import javax.inject.Inject

data class DashboardState(
    val shopId: String? = null,
    val summary: DashboardSummary? = null,
    val loading: Boolean = true,
)

@HiltViewModel
class DashboardViewModel
    @Inject
    constructor(
        private val dashboard: DashboardRepository,
        shops: ShopRepository,
        private val clock: Clock,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(DashboardState())
        val state = mutableState.asStateFlow()
        private val refreshRequests = Channel<String>(Channel.CONFLATED)
        val refreshes = refreshRequests.receiveAsFlow()

        init {
            viewModelScope.launch {
                shops.observeActive().collectLatest { shop ->
                    mutableState.value = DashboardState(shopId = shop?.id, loading = shop != null)
                    if (shop != null) {
                        days().distinctUntilChanged().collectLatest { today ->
                            dashboard.observe(shop.id, today).collect { summary ->
                                mutableState.update { it.copy(summary = summary, loading = false) }
                            }
                        }
                    }
                }
            }
        }

        fun refresh() {
            state.value.shopId?.let { refreshRequests.trySend(it) }
        }

        private fun days() =
            flow {
                while (true) {
                    emit(CeteleClock.today(clock))
                    delay(DATE_POLL_MILLIS)
                }
            }

        private companion object {
            const val DATE_POLL_MILLIS = 60_000L
        }
    }
