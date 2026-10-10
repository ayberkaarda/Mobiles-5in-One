package app.cetele.android.core.data.media

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import app.cetele.android.core.data.vault.InMemoryVault
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class EncryptedPhotoStoreTest {
    @Test fun roundTripEncryptedAtRestAndLruEviction() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val directory = File(context.noBackupFilesDir, "lru-" + java.util.UUID.randomUUID())
        val store = EncryptedPhotoStore(directory, InMemoryVault(), 80)
        try {
            val bytes = ByteArray(10) { it.toByte() }
            store.save("entry-a", bytes)
            assertArrayEquals(bytes, store.open("entry-a"))
            assertTrue(!File(directory, "entry-a.jpg.enc").readBytes().contentEquals(bytes))
            File(directory, "entry-a.jpg.enc").setLastModified(1)
            store.save("entry-b", bytes)
            assertEquals(2, directory.listFiles()!!.size)
            File(directory, "entry-b.jpg.enc").setLastModified(2)
            store.save("entry-c", bytes)
            assertEquals(2, directory.listFiles()!!.size)
            assertNull(store.open("entry-a"))
            assertArrayEquals(bytes, store.open("entry-b"))
            store.clear()
            assertEquals(0, directory.listFiles()!!.size)
        } finally {
            store.clear()
            directory.delete()
        }
    }

    @Test fun pendingUploadsSurviveEvictionAndCapacityFailure() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val directory = File(context.noBackupFilesDir, "pending-" + java.util.UUID.randomUUID())
        val store = EncryptedPhotoStore(directory, InMemoryVault(), 80)
        try {
            val bytes = ByteArray(10) { 1 }
            store.save("pending-a", bytes, pending = true)
            store.save("cached-b", bytes)
            store.save("pending-c", bytes, pending = true)
            assertNull(store.open("cached-b"))
            assertArrayEquals(bytes, store.open("pending-a"))
            assertTrue(runCatching { store.save("pending-d", bytes, pending = true) }.isFailure)
            assertArrayEquals(bytes, store.open("pending-a"))
            assertArrayEquals(bytes, store.open("pending-c"))
            assertNull(store.open("pending-d"))
            store.markReady("pending-a")
            store.save("pending-d", bytes, pending = true)
            assertNull(store.open("pending-a"))
            assertArrayEquals(bytes, store.open("pending-d"))
        } finally {
            store.clear()
            directory.delete()
        }
    }
}
