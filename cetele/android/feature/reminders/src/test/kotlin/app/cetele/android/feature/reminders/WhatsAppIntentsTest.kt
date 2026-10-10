package app.cetele.android.feature.reminders

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.ContextWrapper
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class WhatsAppIntentsTest {
    private class RecordingContext(
        private val rejectWhatsApp: Boolean,
    ) : ContextWrapper(
            ApplicationProvider.getApplicationContext<Application>(),
        ) {
        val attempts = mutableListOf<Intent>()

        override fun startActivity(intent: Intent) {
            attempts.add(intent)
            if (rejectWhatsApp && intent.`package` == "com.whatsapp") throw ActivityNotFoundException()
        }
    }

    @Test
    fun targetsWhatsAppWithPlainText() {
        val context = RecordingContext(false)
        WhatsAppIntents.send(context, "Hesap dökümünüz")
        val intent = context.attempts.single()
        assertEquals(Intent.ACTION_SEND, intent.action)
        assertEquals("com.whatsapp", intent.`package`)
        assertEquals("text/plain", intent.type)
        assertEquals("Hesap dökümünüz", intent.getStringExtra(Intent.EXTRA_TEXT))
        assertTrue(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }

    @Test
    fun unresolvedWhatsAppFallsBackToUnrestrictedChooser() {
        val context = RecordingContext(true)
        WhatsAppIntents.send(context, "Hesap dökümünüz")
        assertEquals(2, context.attempts.size)
        val chooser = context.attempts.last()
        assertEquals(Intent.ACTION_CHOOSER, chooser.action)
        val intent = requireNotNull(chooser.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java))
        assertNull(intent.`package`)
        assertEquals(Intent.ACTION_SEND, intent.action)
        assertEquals("text/plain", intent.type)
        assertEquals("Hesap dökümünüz", intent.getStringExtra(Intent.EXTRA_TEXT))
    }
}
