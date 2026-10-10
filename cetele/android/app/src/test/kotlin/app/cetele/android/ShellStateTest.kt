package app.cetele.android

import app.cetele.android.core.data.settings.ThemeMode
import app.cetele.android.core.data.sync.SyncStatus
import app.cetele.android.core.designsystem.component.SyncStatusSummary
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.network.dto.problem.ProblemCodes
import app.cetele.android.feature.export.navigation.ExportRoutes
import app.cetele.android.feature.shop.navigation.ShopRoutes
import app.cetele.android.shop.ShopHomeAction
import app.cetele.android.shop.shopHomeActions
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ShellStateTest {
    @Test
    fun `owner sees every shop action, staff none of the owner-only ones`() {
        assertEquals(
            listOf(ShopRoutes.Switcher, ShopRoutes.Edit, ShopRoutes.Members, ExportRoutes.All),
            shopHomeActions(ShopRole.OWNER).map(ShopHomeAction::route),
        )
        assertEquals(
            listOf(ShopRoutes.Switcher, ShopRoutes.Edit),
            shopHomeActions(ShopRole.STAFF).map(ShopHomeAction::route),
        )
        assertEquals(listOf(ShopHomeAction.SWITCH), shopHomeActions(null))
    }

    @Test
    fun `sync status of the active shop feeds the customer list chip`() {
        val status = SyncStatus(pendingCount = 4, blockedCount = 1, rejectedCount = 2, offline = true)

        assertEquals(SyncStatusSummary(4, 1, 2, offline = true), status.summary())
    }

    @Test
    fun `customer limit banner follows the last sync error code`() {
        assertTrue(SyncStatus(lastErrorCode = ProblemCodes.PLAN_CUSTOMER_LIMIT).customerLimitReached())
        assertFalse(SyncStatus(lastErrorCode = "validation.failed").customerLimitReached())
        assertFalse(SyncStatus().customerLimitReached())
    }

    @Test
    fun `theme setting overrides the system only when chosen`() {
        assertTrue(ThemeMode.SYSTEM.isDark(systemDark = true))
        assertFalse(ThemeMode.SYSTEM.isDark(systemDark = false))
        assertTrue(ThemeMode.DARK.isDark(systemDark = false))
        assertFalse(ThemeMode.LIGHT.isDark(systemDark = true))
    }
}
