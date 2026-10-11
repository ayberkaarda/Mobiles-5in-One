package app.cetele.android.core.designsystem

import android.app.Activity
import android.app.Application
import android.view.WindowManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class PinWindowProtectionTest {
    @Test fun protectionEndsAfterLastPinScreenLeaves() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        try {
            val window = controller.get().window
            assertFalse(window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
            PinWindowProtection.enter(window)
            PinWindowProtection.enter(window)
            PinWindowProtection.leave(window)
            assertTrue(window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
            PinWindowProtection.leave(window)
            assertFalse(window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        } finally {
            controller.destroy()
        }
    }

    @Test fun preexistingProtectionIsPreserved() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        try {
            val window = controller.get().window
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            PinWindowProtection.enter(window)
            PinWindowProtection.leave(window)
            assertTrue(window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        } finally {
            controller.destroy()
        }
    }
}
