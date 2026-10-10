package app.cetele.android.feature.export

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import app.cetele.android.feature.export.share.ExportShare
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class ExportShareTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()

    @Test
    fun sendUsesContentStreamClipAndReadPermissionForBothFormats() {
        listOf("application/pdf", "text/csv").forEach { mime ->
            val uri = Uri.parse("content://${context.packageName}.files/exports/statement")
            val send = ExportShare.sendIntent(context, uri, "statement", mime)
            assertEquals(Intent.ACTION_SEND, send.action)
            assertEquals(mime, send.type)
            assertEquals(uri, send.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java))
            assertNotNull(send.clipData)
            assertEquals(uri, send.clipData?.getItemAt(0)?.uri)
            assertTrue(send.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
            assertEquals(0, send.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
    }

    @Test
    fun chooserPreservesSendIntentAndCanLaunchFromApplicationContext() {
        val uri = Uri.parse("content://${context.packageName}.files/exports/statement")
        val send = ExportShare.sendIntent(context, uri, "statement", "application/pdf")
        val chooser = ExportShare.chooser(context, send)
        assertEquals(Intent.ACTION_CHOOSER, chooser.action)
        assertEquals(send, chooser.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java))
        assertTrue(chooser.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(chooser.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }

    @Test(expected = IllegalArgumentException::class)
    fun filesOutsideExportsCannotBeShared() {
        val file = context.cacheDir.resolve("private.txt").apply { writeText("private") }
        ExportShare.intent(context, file, "text/plain")
    }
}
