package app.cetele.android.core.data.media

import android.content.Context
import android.util.AtomicFile
import app.cetele.android.core.data.vault.AesGcmBox
import app.cetele.android.core.data.vault.SealedBox
import app.cetele.android.core.data.vault.Vault
import app.cetele.android.core.data.vault.VaultKeys
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.SecureRandom
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class EncryptedPhotoStore(
    private val directory: File,
    private val vault: Vault,
    private val maxBytes: Long = CACHE_BYTES,
) {
    @Inject
    constructor(
        @ApplicationContext context: Context,
        vault: Vault,
    ) : this(File(context.noBackupFilesDir, "photos"), vault)

    private fun key(): SecretKeySpec {
        val bytes =
            vault.get(VaultKeys.PHOTO_KEY)
                ?: ByteArray(KEY_BYTES).also {
                    SecureRandom().nextBytes(it)
                    vault.put(VaultKeys.PHOTO_KEY, it)
                }
        return SecretKeySpec(bytes, "AES")
    }

    private fun file(entryId: String): File {
        require(entryId.matches(Regex("[a-zA-Z0-9-]+")))
        return File(directory, "$entryId.jpg.enc")
    }

    @Synchronized fun save(
        entryId: String,
        bytes: ByteArray,
        pending: Boolean = false,
    ): String {
        require(bytes.size.toLong() + AesGcmBox.IV_BYTES + AesGcmBox.TAG_BITS / BITS_PER_BYTE <= maxBytes)
        check(directory.exists() || directory.mkdirs())
        if (pending) check(pinFile(entryId).createNewFile() || pinFile(entryId).exists())
        val target = AtomicFile(file(entryId))
        val box = AesGcmBox.seal(key(), bytes, entryId.toByteArray(Charsets.UTF_8))
        val stream = target.startWrite()
        try {
            stream.write(box.iv)
            stream.write(box.ciphertext)
            target.finishWrite(stream)
        } catch (
            exception: java.io.IOException,
        ) {
            target.failWrite(stream)
            throw exception
        }
        target.baseFile.setLastModified(System.currentTimeMillis())
        evict()
        if ((directory.listFiles()?.filter { it.name.endsWith(".jpg.enc") }?.sumOf { it.length() } ?: 0L) > maxBytes) {
            remove(entryId)
            error("Photo cache is full of pending uploads")
        }
        return target.baseFile.path
    }

    @Synchronized fun open(entryId: String): ByteArray? {
        val target = file(entryId)
        if (!target.exists()) return null
        val bytes = AtomicFile(target).readFully()
        require(bytes.size >= AesGcmBox.IV_BYTES + AesGcmBox.TAG_BITS / BITS_PER_BYTE)
        val plaintext =
            AesGcmBox.open(
                key(),
                SealedBox(bytes.copyOfRange(0, AesGcmBox.IV_BYTES), bytes.copyOfRange(AesGcmBox.IV_BYTES, bytes.size)),
                entryId.toByteArray(Charsets.UTF_8),
            )
        target.setLastModified(System.currentTimeMillis())
        return plaintext
    }

    private fun pinFile(entryId: String): File = File(file(entryId).path + PENDING_SUFFIX)

    @Synchronized fun markReady(entryId: String) {
        check(pinFile(entryId).delete() || !pinFile(entryId).exists())
        evict()
    }

    @Synchronized fun remove(entryId: String) {
        AtomicFile(file(entryId)).delete()
        check(pinFile(entryId).delete() || !pinFile(entryId).exists())
    }

    @Synchronized fun clear() {
        directory.listFiles()?.forEach { check(it.delete() || !it.exists()) }
    }

    private fun evict() {
        val files =
            directory
                .listFiles()
                ?.filter {
                    it.name.endsWith(".jpg.enc")
                }?.sortedWith(compareBy({ it.lastModified() }, { it.name }))
                ?: return
        var total = files.sumOf { it.length() }
        // Oldest first; files still waiting for upload are never evicted.
        for (file in files.filterNot { File(it.path + PENDING_SUFFIX).exists() }) {
            if (total <= maxBytes) break
            val size = file.length()
            check(file.delete())
            total -= size
        }
    }

    companion object {
        private const val KEY_BYTES = 32
        private const val PENDING_SUFFIX = ".pending"
        private const val BITS_PER_BYTE = 8
        const val CACHE_BYTES =
            200L * 1024 * 1024
    }
}
