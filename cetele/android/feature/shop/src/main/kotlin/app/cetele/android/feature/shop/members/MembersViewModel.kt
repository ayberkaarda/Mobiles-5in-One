package app.cetele.android.feature.shop.members

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.dto.shops.MemberView
import app.cetele.android.feature.shop.ShopFailure
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MembersState(
    val shopId: String? = null,
    val role: ShopRole? = null,
    val members: List<MemberView> = emptyList(),
    val removal: MemberView? = null,
    val busy: Boolean = false,
    val failure: ShopFailure? = null,
)

@HiltViewModel
class MembersViewModel
    @Inject
    constructor(
        private val shops: ShopRepository,
        private val api: ShopsApi,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow(MembersState())
        val state = mutableState.asStateFlow()

        init {
            viewModelScope.launch {
                shops.observeActive().collect { shop ->
                    mutableState.value = MembersState(shopId = shop?.id, role = shop?.role)
                    if (shop?.role == ShopRole.OWNER) refresh()
                }
            }
        }

        fun refresh() {
            val current = state.value
            val id = current.shopId ?: return
            if (current.role != ShopRole.OWNER || current.busy) return
            mutableState.value = current.copy(busy = true, failure = null)
            viewModelScope.launch {
                val result = api.members(id)
                if (state.value.shopId == id && state.value.role == ShopRole.OWNER) {
                    mutableState.value =
                        when (result) {
                            is ApiResult.Success -> state.value.copy(busy = false, members = result.value.members)
                            is ApiResult.Failure -> state.value.copy(busy = false, failure = ShopFailure.from(result))
                        }
                }
            }
        }

        fun requestRemoval(member: MemberView) {
            if (state.value.role == ShopRole.OWNER && !state.value.busy && member in state.value.members) {
                mutableState.value = state.value.copy(removal = member)
            }
        }

        fun dismissRemoval() {
            if (!state.value.busy) mutableState.value = state.value.copy(removal = null)
        }

        fun remove() {
            val current = state.value
            val id = current.shopId
            val member = current.removal
            val allowed = current.role == ShopRole.OWNER && !current.busy
            if (id == null || member == null || !allowed) return
            mutableState.value = current.copy(busy = true, failure = null)
            viewModelScope.launch {
                val result = api.removeMember(id, member.userId)
                if (state.value.shopId == id && state.value.role == ShopRole.OWNER) {
                    mutableState.value =
                        when (result) {
                            is ApiResult.Success -> {
                                state.value.copy(
                                    busy = false,
                                    removal = null,
                                    members =
                                        state.value.members.filterNot {
                                            it.userId ==
                                                member.userId
                                        },
                                )
                            }

                            is ApiResult.Failure -> {
                                state.value.copy(busy = false, removal = null, failure = ShopFailure.from(result))
                            }
                        }
                }
            }
        }
    }
