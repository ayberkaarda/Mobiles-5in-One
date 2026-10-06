package app.cetele.android.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
enum class ShopRole {
    OWNER,
    STAFF,
}

@Serializable
enum class ShopPlan {
    FREE,
    PRO,
}

@Serializable
enum class ShopType {
    BAKKAL,
    MANAV,
    KASAP,
    BERBER,
    KAHVEHANE,
    DIGER,
}

@Serializable
enum class ConsentSource {
    IN_PERSON,
    PHONE,
    WRITTEN,
    OTHER,
}

@Serializable
enum class EntryType {
    DEBT,
    PAYMENT,
}

@Serializable
enum class SyncKind {
    CUSTOMER_UPSERT,
    CUSTOMER_DELETE,
    ENTRY_CREATE,
}

@Serializable
enum class OperationStatus {
    APPLIED,
    DUPLICATE,
    REJECTED,
}

@Serializable
enum class ChangeEntity {
    CUSTOMER,
    ENTRY,
}

@Serializable
enum class ChangeOp {
    UPSERT,
    DELETE,
}

@Serializable
enum class MediaStatus {
    PENDING,
    READY,
    FAILED,
    EXPIRED,
}
