package app.cetele.android.startup

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import app.cetele.android.core.data.session.SessionState
import app.cetele.android.core.data.session.SignOutReason
import app.cetele.android.core.data.settings.UserSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SyncStartupTest {
    private val signedIn = SessionState.SignedIn("user-1", "+905551112233")

    @Test
    fun `active shop is scheduled at start, on shop switch and again after signing back in`() =
        runTest(UnconfinedTestDispatcher()) {
            val session = MutableStateFlow<SessionState>(signedIn)
            val settings = MutableStateFlow(UserSettings(activeShopId = "shop-1"))
            val seen = mutableListOf<String>()
            val job = launch { activeShopWhileSignedIn(session, settings).collect { seen += it } }

            settings.value = settings.value.copy(lockTimeoutSeconds = 30)
            settings.value = settings.value.copy(activeShopId = "shop-2")
            session.value = SessionState.SignedOut(SignOutReason.USER)
            session.value = signedIn
            job.cancel()

            assertEquals(listOf("shop-1", "shop-2", "shop-2"), seen)
        }

    @Test
    fun `nothing is scheduled while signed out or before a shop is chosen`() =
        runTest(UnconfinedTestDispatcher()) {
            val session = MutableStateFlow<SessionState>(SessionState.SignedOut())
            val settings = MutableStateFlow(UserSettings(activeShopId = "shop-1"))
            val seen = mutableListOf<String>()
            val job = launch { activeShopWhileSignedIn(session, settings).collect { seen += it } }

            settings.value = UserSettings()
            session.value = signedIn
            settings.value = UserSettings(activeShopId = "shop-5")
            job.cancel()

            assertEquals(listOf("shop-5"), seen)
        }

    @Test
    fun `process moves reach the lock in the order they happened`() =
        runTest(UnconfinedTestDispatcher()) {
            val moves = mutableListOf<String>()
            val visibility =
                object : AppVisibility {
                    override suspend fun onForeground() {
                        moves += "start"
                    }

                    override suspend fun onBackground() {
                        moves += "stop"
                    }
                }
            val job = Job()
            val scope = CoroutineScope(coroutineContext + job)
            val observer = LockLifecycleObserver(visibility, scope)
            val owner = StubOwner()

            observer.onStart(owner)
            observer.onStop(owner)
            observer.onStart(owner)
            job.cancel()

            assertEquals(listOf("start", "stop", "start"), moves)
        }

    private class StubOwner : LifecycleOwner {
        override val lifecycle: Lifecycle = LifecycleRegistry.createUnsafe(this)
    }
}
