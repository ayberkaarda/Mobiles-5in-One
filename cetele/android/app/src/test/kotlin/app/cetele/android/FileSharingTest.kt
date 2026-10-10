package app.cetele.android

import android.app.Application
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.xmlpull.v1.XmlPullParser

/**
 * The export and capture features share files through `${applicationId}.files`; only their cache folders are exposed.
 * (FileProvider's own path matching assumes '/' separators, so it is checked on device rather than on a Windows host.)
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class FileSharingTest {
    private val context: Application = ApplicationProvider.getApplicationContext()

    @Test
    fun providerIsRegisteredPrivatelyUnderTheFeatureAuthority() {
        val provider =
            context.packageManager.resolveContentProvider("${context.packageName}.files", PackageManager.GET_META_DATA)

        assertNotNull(provider)
        assertEquals("androidx.core.content.FileProvider", provider!!.name)
        assertFalse(provider.exported)
        assertEquals(R.xml.file_paths, provider.metaData.getInt("android.support.FILE_PROVIDER_PATHS"))
    }

    @Test
    fun onlyExportAndCaptureCacheFoldersAreShared() {
        val shared = mutableListOf<String>()
        context.resources.getXml(R.xml.file_paths).use { parser ->
            while (parser.next() != XmlPullParser.END_DOCUMENT) {
                if (parser.eventType == XmlPullParser.START_TAG && parser.name != "paths") {
                    shared += "${parser.name}:${parser.getAttributeValue(null, "path")}"
                }
            }
        }

        assertEquals(listOf("cache-path:exports/", "cache-path:captures/"), shared)
    }
}
