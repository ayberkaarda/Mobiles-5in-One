package app.cetele.android.startup

import app.cetele.android.core.data.session.SessionState
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.domain.model.Shop
import app.cetele.android.core.domain.model.ShopPlan
import app.cetele.android.core.domain.model.ShopRole
import app.cetele.android.core.domain.model.ShopType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.IOException
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class BillingRestoreStartupTest {
    private val signedIn = SessionState.SignedIn("user-1", "+905551112233")

    @Test
    fun `restore waits for an owned shop and runs once per signed-in session`() =
        runTest(UnconfinedTestDispatcher()) {
            val session = MutableStateFlow<SessionState>(signedIn)
            val shops = MutableStateFlow(emptyList<Shop>())
            val seen = mutableListOf<String>()
            val job = launch { ownerSessions(session, shops).collect { seen += it } }

            shops.value = listOf(shop("staff-shop", ShopRole.STAFF))
            assertEquals(emptyList<String>(), seen)
            shops.value = listOf(shop("staff-shop", ShopRole.STAFF), shop("own-shop", ShopRole.OWNER))
            shops.value = listOf(shop("own-shop", ShopRole.OWNER), shop("second", ShopRole.OWNER))
            session.value = SessionState.SignedOut(SignOutReason.USER)
            session.value = signedIn
            session.value = SessionState.SignedIn("user-2", "+905551112244")
            job.cancel()

            assertEquals(listOf("user-1", "user-1", "user-2"), seen)
        }

    @Test
    fun `nothing is restored while signed out or for staff only`() =
        runTest(UnconfinedTestDispatcher()) {
            val session = MutableStateFlow<SessionState>(SessionState.SignedOut())
            val shops = MutableStateFlow(listOf(shop("own-shop", ShopRole.OWNER)))
            val restore = CountingRestore()
            val job = restoreForOwnerSessions(session, shops, restore)

            assertEquals(0, restore.calls)
            shops.value = listOf(shop("staff-shop", ShopRole.STAFF))
            session.value = signedIn
            job.cancel()

            assertEquals(0, restore.calls)
        }

    @Test
    fun `a failed restore does not stop the trigger for the next session`() =
        runTest(UnconfinedTestDispatcher()) {
            val session = MutableStateFlow<SessionState>(signedIn)
            val shops = MutableStateFlow(listOf(shop("own-shop", ShopRole.OWNER)))
            val failures = mutableListOf<Exception>(IOException("offline"), IllegalStateException("no store"))
            val restore = CountingRestore(failures)
            val job = restoreForOwnerSessions(session, shops, restore)

            session.value = SessionState.SignedOut(SignOutReason.USER)
            session.value = signedIn
            session.value = SessionState.SignedOut(SignOutReason.USER)
            session.value = signedIn
            job.cancel()

            assertEquals(3, restore.calls)
        }

    private class CountingRestore(
        private val failures: MutableList<Exception> = mutableListOf(),
    ) : PurchaseRestore {
        var calls = 0

        override suspend fun restore() {
            calls++
            if (failures.isNotEmpty()) throw failures.removeAt(0)
        }
    }

    private fun shop(
        id: String,
        role: ShopRole,
    ) = Shop(id, "Dükkân", ShopType.BAKKAL, "İstanbul", "Kadıköy", ShopPlan.FREE, role, Instant.EPOCH)
}
