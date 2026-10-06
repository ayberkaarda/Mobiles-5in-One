package app.cetele.android.core.network

import app.cetele.android.core.network.dto.auth.OtpRequestBody
import app.cetele.android.core.network.dto.auth.OtpVerifyBody
import app.cetele.android.core.network.dto.auth.RefreshBody
import app.cetele.android.core.network.dto.auth.SignInResponse
import app.cetele.android.core.network.dto.auth.TokenResponse
import app.cetele.android.core.network.dto.auth.UserSummary
import app.cetele.android.core.network.dto.me.AccountDeletionBody
import app.cetele.android.core.network.dto.me.AccountDeletionReceipt
import app.cetele.android.core.network.dto.me.DeletionStatus
import app.cetele.android.core.network.dto.me.Me
import app.cetele.android.core.network.dto.me.MePatchBody
import app.cetele.android.core.network.dto.me.MembershipSummary
import app.cetele.android.core.network.dto.media.MediaDownloadView
import app.cetele.android.core.network.dto.media.MediaPresignRequest
import app.cetele.android.core.network.dto.media.MediaReadyView
import app.cetele.android.core.network.dto.media.MediaUploadView
import app.cetele.android.core.network.dto.problem.ProblemFieldError
import app.cetele.android.core.network.dto.reminders.QuotaState
import app.cetele.android.core.network.dto.reminders.ReminderRequest
import app.cetele.android.core.network.dto.reminders.ReminderResponse
import app.cetele.android.core.network.dto.shops.AcceptedInvitation
import app.cetele.android.core.network.dto.shops.CreateInvitationRequest
import app.cetele.android.core.network.dto.shops.CreateShopRequest
import app.cetele.android.core.network.dto.shops.DeletionReceipt
import app.cetele.android.core.network.dto.shops.IssuedInvitation
import app.cetele.android.core.network.dto.shops.MemberList
import app.cetele.android.core.network.dto.shops.MemberView
import app.cetele.android.core.network.dto.shops.OwnershipBody
import app.cetele.android.core.network.dto.shops.OwnershipReceipt
import app.cetele.android.core.network.dto.shops.ReauthCode
import app.cetele.android.core.network.dto.shops.ShopView
import app.cetele.android.core.network.dto.shops.UpdateShopRequest
import app.cetele.android.core.network.dto.statements.StatementLinkRequest
import app.cetele.android.core.network.dto.statements.StatementLinkResponse
import app.cetele.android.core.network.dto.sync.ChangeView
import app.cetele.android.core.network.dto.sync.CustomerInput
import app.cetele.android.core.network.dto.sync.CustomerSnapshot
import app.cetele.android.core.network.dto.sync.EntryInput
import app.cetele.android.core.network.dto.sync.EntrySnapshot
import app.cetele.android.core.network.dto.sync.OperationResult
import app.cetele.android.core.network.dto.sync.PullResponse
import app.cetele.android.core.network.dto.sync.PushRequest
import app.cetele.android.core.network.dto.sync.PushResponse
import app.cetele.android.core.network.dto.sync.SyncOperation
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import java.util.UUID

class DtoSerializationTest {
    private val dummy = UUID.randomUUID().toString()

    private fun <T> roundTrip(
        serializer: KSerializer<T>,
        sample: String,
    ) {
        val original = NetworkJson.parseToJsonElement(sample) as JsonObject
        val value = NetworkJson.decodeFromString(serializer, sample)
        val encoded = NetworkJson.encodeToString(serializer, value)
        assertEquals(value, NetworkJson.decodeFromString(serializer, encoded))
        val encodedObject = NetworkJson.parseToJsonElement(encoded) as JsonObject
        original.forEach { (key, expected) -> assertEquals(expected, encodedObject[key], key) }
        val extended = JsonObject(original + ("futureField" to kotlinx.serialization.json.JsonPrimitive(true)))
        assertEquals(value, NetworkJson.decodeFromJsonElement(serializer, extended))
        assertFalse(encoded.contains(":null"))
    }

    @Test
    fun `auth DTOs preserve wire fields`() {
        roundTrip(
            OtpRequestBody.serializer(),
            """
            {
              "deviceId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "integrityToken": "$dummy",
              "phone": "+905321234567"
            }
            """.trimIndent(),
        )
        roundTrip(
            OtpVerifyBody.serializer(),
            """
            {
              "appVersion": "sample",
              "code": "123456",
              "deviceId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "model": "sample",
              "phone": "+905321234567"
            }
            """.trimIndent(),
        )
        roundTrip(
            SignInResponse.serializer(),
            """
            {
              "accessToken": "$dummy",
              "expiresIn": 1,
              "isNewUser": true,
              "refreshToken": "$dummy",
              "user": {
                "displayName": "sample",
                "id": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
              }
            }
            """.trimIndent(),
        )
        roundTrip(
            UserSummary.serializer(),
            """
            {
              "displayName": "sample",
              "id": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
            }
            """.trimIndent(),
        )
        roundTrip(
            RefreshBody.serializer(),
            """
            {
              "refreshToken": "$dummy"
            }
            """.trimIndent(),
        )
        roundTrip(
            TokenResponse.serializer(),
            """
            {
              "accessToken": "$dummy",
              "expiresIn": 1,
              "refreshToken": "$dummy"
            }
            """.trimIndent(),
        )
    }

    @Test
    fun `me DTOs preserve wire fields`() {
        roundTrip(
            Me.serializer(),
            """
            {
              "deletion": {
                "blocked": true,
                "graceUntil": "2026-10-06T10:00:00Z",
                "requestedAt": "2026-10-06T10:00:00Z"
              },
              "displayName": "sample",
              "id": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "memberships": [
                {
                  "role": "OWNER",
                  "shopId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
                }
              ],
              "phone": "+905321234567"
            }
            """.trimIndent(),
        )
        roundTrip(
            MembershipSummary.serializer(),
            """
            {
              "role": "OWNER",
              "shopId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
            }
            """.trimIndent(),
        )
        roundTrip(
            DeletionStatus.serializer(),
            """
            {
              "blocked": true,
              "graceUntil": "2026-10-06T10:00:00Z",
              "requestedAt": "2026-10-06T10:00:00Z"
            }
            """.trimIndent(),
        )
        roundTrip(
            MePatchBody.serializer(),
            """
            {
              "displayName": "sample"
            }
            """.trimIndent(),
        )
        roundTrip(
            AccountDeletionBody.serializer(),
            """
            {
              "code": "123456",
              "deleteOwnedShops": true
            }
            """.trimIndent(),
        )
        roundTrip(
            AccountDeletionReceipt.serializer(),
            """
            {
              "graceUntil": "2026-10-06T10:00:00Z",
              "requestedAt": "2026-10-06T10:00:00Z",
              "shopsToDelete": [
                "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
              ]
            }
            """.trimIndent(),
        )
    }

    @Test
    fun `shops DTOs preserve wire fields`() {
        roundTrip(
            CreateShopRequest.serializer(),
            """
            {
              "il": "sample",
              "ilce": "sample",
              "name": "sample",
              "type": "BAKKAL"
            }
            """.trimIndent(),
        )
        roundTrip(
            UpdateShopRequest.serializer(),
            """
            {
              "il": "sample",
              "ilce": "sample",
              "name": "sample",
              "type": "BAKKAL"
            }
            """.trimIndent(),
        )
        roundTrip(
            ShopView.serializer(),
            """
            {
              "createdAt": "2026-10-06T10:00:00Z",
              "id": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "il": "sample",
              "ilce": "sample",
              "name": "sample",
              "plan": "FREE",
              "role": "OWNER",
              "type": "BAKKAL"
            }
            """.trimIndent(),
        )
        roundTrip(
            CreateInvitationRequest.serializer(),
            """
            {
              "phone": "+905321234567"
            }
            """.trimIndent(),
        )
        roundTrip(
            IssuedInvitation.serializer(),
            """
            {
              "code": "123456",
              "expiresAt": "2026-10-06T10:00:00Z",
              "id": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "phone": "+905321234567"
            }
            """.trimIndent(),
        )
        roundTrip(
            AcceptedInvitation.serializer(),
            """
            {
              "role": "OWNER",
              "shopId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
            }
            """.trimIndent(),
        )
        roundTrip(
            MemberList.serializer(),
            """
            {
              "members": [
                {
                  "displayName": "sample",
                  "joinedAt": "2026-10-06T10:00:00Z",
                  "phone": "+905321234567",
                  "role": "OWNER",
                  "userId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
                }
              ]
            }
            """.trimIndent(),
        )
        roundTrip(
            MemberView.serializer(),
            """
            {
              "displayName": "sample",
              "joinedAt": "2026-10-06T10:00:00Z",
              "phone": "+905321234567",
              "role": "OWNER",
              "userId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
            }
            """.trimIndent(),
        )
        roundTrip(
            ReauthCode.serializer(),
            """
            {
              "code": "123456"
            }
            """.trimIndent(),
        )
        roundTrip(
            DeletionReceipt.serializer(),
            """
            {
              "graceUntil": "2026-10-06T10:00:00Z",
              "requestedAt": "2026-10-06T10:00:00Z"
            }
            """.trimIndent(),
        )
        roundTrip(
            OwnershipBody.serializer(),
            """
            {
              "code": "123456",
              "userId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
            }
            """.trimIndent(),
        )
        roundTrip(
            OwnershipReceipt.serializer(),
            """
            {
              "ownerUserId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "previousOwnerUserId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "shopId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
            }
            """.trimIndent(),
        )
    }

    @Test
    fun `sync DTOs preserve wire fields`() {
        roundTrip(
            PushRequest.serializer(),
            """
            {
              "operations": [
                {
                  "clientId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
                  "clientSeq": 1,
                  "customer": {
                    "id": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
                    "name": "sample",
                    "note": "sample",
                    "phone": "+905321234567",
                    "smsConsent": true,
                    "smsConsentAt": "2026-10-06T10:00:00Z",
                    "smsConsentSource": "IN_PERSON",
                    "tag": "sample"
                  },
                  "kind": "CUSTOMER_UPSERT"
                }
              ]
            }
            """.trimIndent(),
        )
        roundTrip(
            SyncOperation.serializer(),
            """
            {
              "clientId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "clientSeq": 1,
              "customer": {
                "id": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
                "name": "sample",
                "note": "sample",
                "phone": "+905321234567",
                "smsConsent": true,
                "smsConsentAt": "2026-10-06T10:00:00Z",
                "smsConsentSource": "IN_PERSON",
                "tag": "sample"
              },
              "kind": "CUSTOMER_UPSERT"
            }
            """.trimIndent(),
        )
        roundTrip(
            CustomerInput.serializer(),
            """
            {
              "id": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "name": "sample",
              "note": "sample",
              "phone": "+905321234567",
              "smsConsent": true,
              "smsConsentAt": "2026-10-06T10:00:00Z",
              "smsConsentSource": "IN_PERSON",
              "tag": "sample"
            }
            """.trimIndent(),
        )
        roundTrip(
            EntryInput.serializer(),
            """
            {
              "amountMinor": 12500,
              "customerId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "dueOn": "2026-10-06",
              "id": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "note": "sample",
              "occurredOn": "2026-10-06",
              "photoKey": "media/s1/m1.jpg",
              "reverses": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "type": "DEBT"
            }
            """.trimIndent(),
        )
        roundTrip(
            PushResponse.serializer(),
            """
            {
              "head": 1,
              "results": [
                {
                  "clientId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
                  "code": "required",
                  "entityId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
                  "errors": [
                    {
                      "code": "required",
                      "field": "name"
                    }
                  ],
                  "status": "REJECTED"
                }
              ]
            }
            """.trimIndent(),
        )
        roundTrip(
            OperationResult.serializer(),
            """
            {
              "clientId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "code": "required",
              "entityId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "errors": [
                {
                  "code": "required",
                  "field": "name"
                }
              ],
              "status": "REJECTED"
            }
            """.trimIndent(),
        )
        roundTrip(
            PullResponse.serializer(),
            """
            {
              "changes": [
                {
                  "at": "2026-10-06T10:00:00Z",
                  "entity": "CUSTOMER",
                  "entityId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
                  "op": "UPSERT",
                  "payload": {},
                  "seq": 1
                }
              ],
              "hasMore": true,
              "nextSince": 1
            }
            """.trimIndent(),
        )
        roundTrip(
            ChangeView.serializer(),
            """
            {
              "at": "2026-10-06T10:00:00Z",
              "entity": "CUSTOMER",
              "entityId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "op": "UPSERT",
              "payload": {},
              "seq": 1
            }
            """.trimIndent(),
        )
    }

    @Test
    fun `media DTOs preserve wire fields`() {
        roundTrip(
            MediaPresignRequest.serializer(),
            """
            {
              "contentLength": 1,
              "contentType": "image/jpeg"
            }
            """.trimIndent(),
        )
        roundTrip(
            MediaUploadView.serializer(),
            """
            {
              "expiresAt": "2026-10-06T10:00:00Z",
              "headers": {
                "Content-Type": "image/jpeg",
                "Content-Length": "1"
              },
              "mediaId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "method": "PUT",
              "photoKey": "media/s1/m1.jpg",
              "uploadUrl": "https://storage.example/photo"
            }
            """.trimIndent(),
        )
        roundTrip(
            MediaReadyView.serializer(),
            """
            {
              "bytes": 1,
              "height": 1,
              "mediaId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "photoKey": "media/s1/m1.jpg",
              "status": "PENDING",
              "width": 1
            }
            """.trimIndent(),
        )
        roundTrip(
            MediaDownloadView.serializer(),
            """
            {
              "downloadUrl": "https://storage.example/photo",
              "expiresAt": "2026-10-06T10:00:00Z",
              "mediaId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "photoKey": "media/s1/m1.jpg",
              "status": "PENDING"
            }
            """.trimIndent(),
        )
    }

    @Test
    fun `statements DTOs preserve wire fields`() {
        roundTrip(
            StatementLinkRequest.serializer(),
            """
            {
              "customerId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
            }
            """.trimIndent(),
        )
        roundTrip(
            StatementLinkResponse.serializer(),
            """
            {
              "expiresAt": "2026-10-06T10:00:00Z",
              "linkId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "token": "$dummy",
              "url": "https://storage.example/photo"
            }
            """.trimIndent(),
        )
    }

    @Test
    fun `reminders DTOs preserve wire fields`() {
        roundTrip(
            ReminderRequest.serializer(),
            """
            {
              "channel": "SMS",
              "customerId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "template": "BALANCE"
            }
            """.trimIndent(),
        )
        roundTrip(
            ReminderResponse.serializer(),
            """
            {
              "providerMessageId": "sample",
              "quota": {
                "limit": 30,
                "month": "2026-10",
                "used": 1
              },
              "reminderId": "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
              "sentAt": "2026-10-06T10:00:00Z",
              "status": "SENT"
            }
            """.trimIndent(),
        )
        roundTrip(
            QuotaState.serializer(),
            """
            {
              "limit": 30,
              "month": "2026-10",
              "used": 1
            }
            """.trimIndent(),
        )
    }

    @Test
    fun `problem DTOs preserve wire fields`() {
        roundTrip(
            ProblemFieldError.serializer(),
            """
            {
              "code": "required",
              "field": "name"
            }
            """.trimIndent(),
        )
    }

    @Test
    fun `handoff pull snapshots decode ISO dates and null omissions`() {
        roundTrip(
            CustomerSnapshot.serializer(),
            """
            {
              "id": "c1",
              "name": "Ayşe",
              "smsConsent": true,
              "smsConsentAt": "2026-10-06T10:00:00Z",
              "smsConsentSource": "IN_PERSON",
              "createdAt": "2026-10-06T10:00:00Z",
              "updatedAt": "2026-10-06T10:00:00Z"
            }
            """.trimIndent(),
        )
        roundTrip(
            EntrySnapshot.serializer(),
            """
            {
              "id": "e1",
              "customerId": "c1",
              "type": "DEBT",
              "amountMinor": 12500,
              "currency": "TRY",
              "occurredOn": "2026-10-06",
              "createdAt": "2026-10-06T10:00:00Z"
            }
            """.trimIndent(),
        )
        val problem =
            NetworkJson.decodeFromString<ProblemDetail>(
                """{"title":"Invalid","status":422,"errors":[{"field":"name","code":"required"}]}""",
            )
        assertEquals("required", problem.errors.single().code)
        assertFalse(NetworkJson.encodeToString(ProblemDetail.serializer(), problem).contains(":null"))
    }
}
