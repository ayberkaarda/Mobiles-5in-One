package app.cetele.android.core.data.repository

import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.database.entity.ShopEntity
import app.cetele.android.core.domain.model.ConsentSource
import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.core.domain.model.Money
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import app.cetele.android.core.network.dto.shops.ShopView
import java.time.Instant
import java.time.LocalDate

fun CustomerEntity.asModel(): Customer =
    Customer(
        id,
        shopId,
        name,
        phone,
        note,
        tag,
        smsConsent,
        smsConsentAt?.let(Instant::parse),
        smsConsentSource?.let(ConsentSource::valueOf),
        Instant.parse(createdAt),
        Instant.parse(updatedAt),
        deletedAt?.let(Instant::parse),
    )

fun LedgerEntryEntity.asModel(): LedgerEntry =
    LedgerEntry(
        id,
        shopId,
        customerId,
        EntryType.valueOf(type),
        Money(amountMinor),
        LocalDate.parse(occurredOn),
        dueOn?.let(LocalDate::parse),
        note,
        photoKey,
        reverses,
        reversedBy,
        createdBy,
        Instant.parse(createdAt),
    )

fun ShopEntity.asModel(): Shop =
    Shop(
        id,
        name,
        ShopType.valueOf(type),
        il,
        ilce,
        ShopPlan.valueOf(plan),
        ShopRole.valueOf(role),
        Instant.parse(createdAt),
    )

fun ShopView.toEntity(now: Instant): ShopEntity =
    ShopEntity(id, name, type.name, il, ilce, plan.name, role.name, createdAt.toString(), now.toString())
