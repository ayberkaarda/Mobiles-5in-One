package app.cetele.android.feature.settings.sync

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.database.entity.OutboxEntity
import app.cetele.android.core.data.repository.ShopRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class SyncIssuesViewModel
    @Inject
    constructor(
        shops: ShopRepository,
        private val store: RoomSettingsIssueStore,
    ) : ViewModel() {
        val issues =
            shops
                .observeActive()
                .flatMapLatest { shop ->
                    if (shop == null) flowOf(emptyList()) else store.observe(shop.id)
                }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

        fun remove(row: OutboxEntity) =
            viewModelScope.launch {
                if (row.state == "REJECTED" &&
                    issues.value.any { it.clientId == row.clientId && it.shopId == row.shopId }
                ) {
                    store.remove(row.shopId, row.clientId)
                }
            }

        fun withoutPhoto(row: OutboxEntity) =
            viewModelScope.launch {
                if (canSendWithoutPhoto(row) &&
                    issues.value.any { it.clientId == row.clientId && it.shopId == row.shopId }
                ) {
                    store.withoutPhoto(row.shopId, row.clientId)
                }
            }
    }
