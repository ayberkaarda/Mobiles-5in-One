package app.cetele.android.feature.export

import app.cetele.android.feature.export.share.ExportFiles
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

class ExportFilesTest {
    @TempDir
    lateinit var cache: Path

    @Test
    fun namesAreTurkishAwareSafeAndDeterministicWithUniqueDirectories() {
        val files = ExportFiles(cache.toFile())
        val first = files.csv("Çınar Bakkalı", date)
        val second = files.csv("Çınar Bakkalı", date)
        assertEquals("cetele-cinar-bakkali-20261006.csv", first.name)
        assertNotEquals(first.parentFile, second.parentFile)
        assertEquals("cetele-cinar-bakkali-ayse-20261006.pdf", files.pdf(shop.name, customer.name, date).name)
        assertEquals("dukkan", ExportFiles.slug("../../"))
        assertEquals("istanbul-isik", ExportFiles.slug("İstanbul IŞIK"))
        assertEquals(60, ExportFiles.slug("a".repeat(200)).length)
        assertTrue(first.canonicalFile.toPath().startsWith(cache.resolve("exports")))
    }

    @Test
    fun cleanupDeletesOnlyExportsStrictlyOlderThanOneDay() {
        val files = ExportFiles(cache.toFile())
        val now = 2 * ExportFiles.RETENTION_MILLIS
        val old =
            files.csv("old", date).apply {
                writeText("old")
                assertTrue(setLastModified(now - ExportFiles.RETENTION_MILLIS - 1))
            }
        val boundary =
            files.csv("boundary", date).apply {
                writeText("boundary")
                assertTrue(setLastModified(now - ExportFiles.RETENTION_MILLIS))
            }
        val recent =
            files.pdf(shop.name, customer.name, date).apply {
                writeText("recent")
                assertTrue(setLastModified(now))
            }
        val unrelated =
            cache.resolve("keep.txt").toFile().apply {
                writeText("keep")
                assertTrue(setLastModified(1))
            }
        assertEquals(1, files.cleanup(now))
        assertFalse(old.exists())
        assertFalse(old.parentFile!!.exists())
        assertTrue(boundary.exists())
        assertTrue(recent.exists())
        assertTrue(unrelated.exists())
        assertEquals(0, files.cleanup(now))
    }

    @Test
    fun missingDirectoryAndLegacyFlatExportsAreHandled() {
        val files = ExportFiles(cache.toFile())
        assertEquals(0, files.cleanup())
        val root = cache.resolve("exports").toFile().apply { mkdirs() }
        val old =
            root.resolve("statement.pdf").apply {
                writeText("old")
                assertTrue(setLastModified(1))
            }
        assertEquals(1, files.cleanup(ExportFiles.RETENTION_MILLIS + 2))
        assertFalse(old.exists())
    }
}
