package app.cetele.android.core.network.api

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.di.ApiClient
import app.cetele.android.core.network.dto.shops.AcceptedInvitation
import app.cetele.android.core.network.dto.shops.CreateInvitationRequest
import app.cetele.android.core.network.dto.shops.CreateShopRequest
import app.cetele.android.core.network.dto.shops.DeletionReceipt
import app.cetele.android.core.network.dto.shops.IssuedInvitation
import app.cetele.android.core.network.dto.shops.MemberList
import app.cetele.android.core.network.dto.shops.OwnershipBody
import app.cetele.android.core.network.dto.shops.OwnershipReceipt
import app.cetele.android.core.network.dto.shops.ReauthCode
import app.cetele.android.core.network.dto.shops.ShopView
import app.cetele.android.core.network.dto.shops.UpdateShopRequest
import io.ktor.client.HttpClient
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.HttpMethod
import javax.inject.Inject

interface ShopsApi {
    suspend fun create(body: CreateShopRequest): ApiResult<ShopView>

    suspend fun get(shopId: String): ApiResult<ShopView>

    suspend fun update(
        shopId: String,
        body: UpdateShopRequest,
    ): ApiResult<ShopView>

    suspend fun invite(
        shopId: String,
        body: CreateInvitationRequest,
    ): ApiResult<IssuedInvitation>

    suspend fun accept(code: String): ApiResult<AcceptedInvitation>

    suspend fun members(shopId: String): ApiResult<MemberList>

    suspend fun removeMember(
        shopId: String,
        userId: String,
    ): ApiResult<Unit>

    suspend fun deleteShop(
        shopId: String,
        body: ReauthCode,
    ): ApiResult<DeletionReceipt>

    suspend fun cancelShopDeletion(shopId: String): ApiResult<Unit>

    suspend fun transferOwnership(
        shopId: String,
        body: OwnershipBody,
    ): ApiResult<OwnershipReceipt>
}

class KtorShopsApi
    @Inject
    constructor(
        @ApiClient private val client: HttpClient,
    ) : ShopsApi {
        override suspend fun create(body: CreateShopRequest): ApiResult<ShopView> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/shops")
                setBody(body)
            }

        override suspend fun get(shopId: String): ApiResult<ShopView> =
            client.apiCall {
                method = HttpMethod.Get
                url("v1/shops/${segment(shopId)}")
            }

        override suspend fun update(
            shopId: String,
            body: UpdateShopRequest,
        ): ApiResult<ShopView> =
            client.apiCall {
                method = HttpMethod.Patch
                url("v1/shops/${segment(shopId)}")
                setBody(body)
            }

        override suspend fun invite(
            shopId: String,
            body: CreateInvitationRequest,
        ): ApiResult<IssuedInvitation> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/shops/${segment(shopId)}/invitations")
                setBody(body)
            }

        override suspend fun accept(code: String): ApiResult<AcceptedInvitation> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/invitations/${segment(code)}/accept")
            }

        override suspend fun members(shopId: String): ApiResult<MemberList> =
            client.apiCall {
                method = HttpMethod.Get
                url("v1/shops/${segment(shopId)}/members")
            }

        override suspend fun removeMember(
            shopId: String,
            userId: String,
        ): ApiResult<Unit> =
            client.apiCall {
                method = HttpMethod.Delete
                url("v1/shops/${segment(shopId)}/members/${segment(userId)}")
            }

        override suspend fun deleteShop(
            shopId: String,
            body: ReauthCode,
        ): ApiResult<DeletionReceipt> =
            client.apiCall {
                method = HttpMethod.Delete
                url("v1/shops/${segment(shopId)}")
                setBody(body)
            }

        override suspend fun cancelShopDeletion(shopId: String): ApiResult<Unit> =
            client.apiCall {
                method = HttpMethod.Delete
                url("v1/shops/${segment(shopId)}/deletion")
            }

        override suspend fun transferOwnership(
            shopId: String,
            body: OwnershipBody,
        ): ApiResult<OwnershipReceipt> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/shops/${segment(shopId)}/ownership-transfer")
                setBody(body)
            }
    }
