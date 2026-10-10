package app.cetele.android.core.data.sync

import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.api.SyncApi
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.sync.CustomerInput
import app.cetele.android.core.network.dto.sync.EntryInput
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

object SyncFixtures {
    const val SHOP = "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"
    val instant: Instant = Instant.parse("2026-10-06T10:00:00Z")
    val clock: Clock = Clock.fixed(instant, ZoneOffset.UTC)
    val today: LocalDate = LocalDate.parse("2026-10-06")

    fun engine(
        store: SyncLocalStore,
        api: SyncApi,
        limit: Int = 500,
    ): SyncEngine =
        SyncEngine(
            store,
            api,
            PushBatchBuilder(store),
            PullApplier(store, api, limit),
            RejectionHandler(store),
            SyncLogger {
                _,
                _,
                ->
            },
        )

    fun row(
        id: String,
        kind: SyncKind,
        entityId: String,
        payload: String,
        order: Long = 0,
    ): OutboxRow =
        OutboxRow(
            id,
            SHOP,
            kind.name,
            entityId,
            payload,
            instant.plusSeconds(order).toString(),
            state = "QUEUED",
            updatedAt = instant.plusSeconds(order).toString(),
        )

    fun customerEntity(
        input: CustomerInput,
        at: String = instant.toString(),
    ): CustomerEntity =
        CustomerEntity(
            input.id,
            SHOP,
            input.name,
            input.name.lowercase(),
            input.phone,
            input.note,
            input.tag,
            input.smsConsent,
            input.smsConsentAt?.toString(),
            input.smsConsentSource?.name,
            at,
            at,
        )

    fun entryEntity(input: EntryInput): LedgerEntryEntity =
        LedgerEntryEntity(
            input.id,
            SHOP,
            input.customerId,
            input.type.name,
            input.amountMinor,
            occurredOn = input.occurredOn.toString(),
            dueOn = input.dueOn?.toString(),
            note = input.note,
            photoKey = input.photoKey,
            reverses = input.reverses,
            createdAt = instant.toString(),
        )

    suspend fun customer(
        store: InMemorySyncLocalStore,
        clientId: String,
        id: String,
        name: String,
        order: Long = 0,
    ) {
        val input = CustomerInput(id, name, smsConsent = false)
        val old = store.customers[SHOP to id]
        store.seed(customerEntity(input).copy(createdAt = old?.createdAt ?: instant.plusSeconds(order).toString()))
        store.seed(row(clientId, SyncKind.CUSTOMER_UPSERT, id, NetworkJson.encodeToString(input), order))
    }

    suspend fun entry(
        store: InMemorySyncLocalStore,
        clientId: String,
        input: EntryInput,
        order: Long = 1,
        dependency: String? = null,
    ) {
        store.seed(entryEntity(input))
        input.reverses?.let { id -> store.entries[SHOP to id]?.let { store.seed(it.copy(reversedBy = input.id)) } }
        store.seed(
            row(clientId, SyncKind.ENTRY_CREATE, input.id, NetworkJson.encodeToString(input), order)
                .copy(dependsOnClientId = dependency),
        )
    }

    suspend fun delete(
        store: InMemorySyncLocalStore,
        clientId: String,
        id: String,
        order: Long = 10,
    ) {
        store.customers[SHOP to id]?.let { store.seed(it.copy(deletedAt = instant.plusSeconds(order).toString())) }
        store.seed(
            row(clientId, SyncKind.CUSTOMER_DELETE, id, buildJsonObject { put("customerId", id) }.toString(), order),
        )
    }
}
