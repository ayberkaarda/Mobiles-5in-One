package app.cetele.android.core.data.sync

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Clock
import java.time.ZoneOffset

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RetryAfterPolicyTest {
    @Test fun deadlineSurvivesNewInstanceAndNeverShortensAnExistingWait() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context
            .getSharedPreferences(RetryAfterPolicy.FILE_NAME, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
        val first = RetryAfterPolicy(context, SyncFixtures.clock)
        first.defer(SyncFixtures.SHOP, 91)
        first.defer(SyncFixtures.SHOP, 5)
        val later = Clock.fixed(SyncFixtures.instant.plusMillis(1500), ZoneOffset.UTC)
        assertEquals(90, RetryAfterPolicy(context, later).remainingSeconds(SyncFixtures.SHOP))
        assertEquals(0, first.remainingSeconds("other-shop"))
        val expired = Clock.fixed(SyncFixtures.instant.plusSeconds(91), ZoneOffset.UTC)
        assertEquals(0, RetryAfterPolicy(context, expired).remainingSeconds(SyncFixtures.SHOP))
    }
}
