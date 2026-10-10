package app.cetele.android.core.data.repository

import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.database.writeTransaction
import app.cetele.android.core.data.media.EncryptedPhotoStore
import app.cetele.android.core.data.session.SessionManager
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.MeApi
import app.cetele.android.core.network.api.ShopsApi
import app.cetele.android.core.network.dto.me.DeletionStatus
import app.cetele.android.core.network.dto.me.Me
import app.cetele.android.core.network.dto.shops.CreateShopRequest
import app.cetele.android.core.network.dto.shops.ShopView
import app.cetele.android.core.network.dto.shops.UpdateShopRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import java.time.Clock
import javax.inject.Inject

interface ShopRepository {
    val deletion: Flow<DeletionStatus?>

    fun observeShops(): Flow<List<Shop>>

    fun observeActive(): Flow<Shop?>

    suspend fun setActive(shopId: String)

    suspend fun refresh(): ApiResult<Unit>

    suspend fun create(request: CreateShopRequest): ApiResult<Shop>

    suspend fun join(code: String): ApiResult<Shop>

    suspend fun update(
        shopId: String,
        request: UpdateShopRequest,
    ): ApiResult<Shop>
}

@Suppress("LongParameterList")
class RoomShopRepository
    @Inject
    constructor(
        private val databases: DatabaseStore,
        private val me: MeApi,
        private val shops: ShopsApi,
        private val settings: SettingsRepository,
        private val session: SessionManager,
        private val photos: EncryptedPhotoStore,
        private val clock: Clock,
    ) : ShopRepository {
        private val mutableDeletion = MutableStateFlow<DeletionStatus?>(null)
        override val deletion = mutableDeletion.asStateFlow()

        override fun observeShops(): Flow<List<Shop>> =
            databases.get().shopDao().observeAll().map { rows ->
                rows.map {
                    it.asModel()
                }
            }

        override fun observeActive(): Flow<Shop?> =
            combine(observeShops(), settings.settings) { rows, value ->
                rows.firstOrNull {
                    it.id ==
                        value.activeShopId
                }
            }

        override suspend fun setActive(shopId: String) {
            require(databases.get().shopDao().get(shopId) != null)
            settings.update { it.copy(activeShopId = shopId) }
        }

        override suspend fun refresh(): ApiResult<Unit> =
            when (val result = me.me()) {
                is ApiResult.Failure -> {
                    result
                }

                is ApiResult.Success -> {
                    when (val views = memberShops(result.value)) {
                        is ApiResult.Failure -> {
                            views
                        }

                        is ApiResult.Success -> {
                            replaceShops(views.value)
                            mutableDeletion.value = result.value.deletion
                            ApiResult.Success(Unit, result.status)
                        }
                    }
                }
            }

        private suspend fun memberShops(profile: Me): ApiResult<List<ShopView>> {
            val views = mutableListOf<ShopView>()
            for (membership in profile.memberships) {
                when (val shop = shops.get(membership.shopId)) {
                    is ApiResult.Success -> views.add(shop.value.copy(role = membership.role))
                    is ApiResult.Failure -> return shop
                }
            }
            return ApiResult.Success(views, HTTP_OK)
        }

        /** Stores [views]; shops no longer listed lose every local row, their photos and their cursor. */
        private suspend fun replaceShops(views: List<ShopView>) {
            val db = databases.get()
            val lost = db.shopDao().all().filter { old -> views.none { it.id == old.id } }
            val removedPhotos = mutableListOf<String>()
            db.writeTransaction {
                for (shop in lost) {
                    removedPhotos.addAll(db.pendingPhotoDao().all(shop.id).map { it.entryId })
                    // Entries include remote photos that are absent from the upload queue.
                    removedPhotos.addAll(db.ledgerEntryDao().all(shop.id).map { it.id })
                    db.outboxDao().deleteShop(shop.id)
                    db.pendingPhotoDao().deleteShop(shop.id)
                    db.ledgerEntryDao().deleteShop(shop.id)
                    db.customerDao().deleteShop(shop.id)
                    db.reminderLogDao().deleteShop(shop.id)
                    db.syncCursorDao().deleteShop(shop.id)
                    db.shopDao().delete(shop.id)
                }
                db.shopDao().upsertAll(views.map { it.toEntity(clock.instant()) })
            }
            removedPhotos.distinct().forEach(photos::remove)
            for (shop in lost) session.onMembershipLost(shop.id)
        }

        override suspend fun create(request: CreateShopRequest): ApiResult<Shop> = cache(shops.create(request))

        override suspend fun join(code: String): ApiResult<Shop> =
            when (val accepted = shops.accept(code)) {
                is ApiResult.Success -> cache(shops.get(accepted.value.shopId))
                is ApiResult.Failure -> accepted
            }

        override suspend fun update(
            shopId: String,
            request: UpdateShopRequest,
        ): ApiResult<Shop> = cache(shops.update(shopId, request))

        private suspend fun cache(result: ApiResult<ShopView>): ApiResult<Shop> =
            when (result) {
                is ApiResult.Success -> {
                    val row = result.value.toEntity(clock.instant())
                    databases.get().shopDao().upsertAll(listOf(row))
                    ApiResult.Success(row.asModel(), result.status)
                }

                is ApiResult.Failure -> {
                    result
                }
            }

        private companion object {
            const val HTTP_OK = 200
        }
    }
