package app.cetele.android.feature.reminders

import app.cetele.android.core.domain.model.Customer
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import java.time.Instant

internal val reminderTime: Instant = Instant.parse("2026-10-06T10:00:00Z")

internal fun reminderCustomer(): Customer =
    Customer(
        id = "customer",
        shopId = "shop",
        name = "Ayşe",
        phone = "+905321234567",
        note = null,
        tag = null,
        smsConsent = true,
        smsConsentAt = reminderTime,
        smsConsentSource = app.cetele.android.core.domain.model.ConsentSource.IN_PERSON,
        createdAt = reminderTime,
        updatedAt = reminderTime,
        deletedAt = null,
    )

internal fun reminderShop(): Shop =
    Shop(
        "shop",
        "Köşe Bakkalı",
        ShopType.BAKKAL,
        "İstanbul",
        "Kadıköy",
        ShopPlan.FREE,
        ShopRole.OWNER,
        reminderTime,
    )
