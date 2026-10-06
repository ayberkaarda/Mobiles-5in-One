package app.cetele.android.core.data.vault

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class KeystoreVault
    @Inject
    constructor(
        @ApplicationContext context: Context,
    ) : Vault {
        private val file = AtomicFile(File(context.noBackupFilesDir, "vault.bin"))
        private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

        private fun wrappingKey(): SecretKey {
            val existing = keyStore.getKey(ALIAS, null) as? SecretKey
            if (existing != null) return existing
            return KeyGenerator
                .getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                .apply {
                    init(
                        KeyGenParameterSpec
                            .Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                            .setKeySize(KEY_BITS)
                            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                            .setUserAuthenticationRequired(false)
                            .build(),
                    )
                }.generateKey()
        }

        @Synchronized override fun get(key: String): ByteArray? =
            read()[key]?.let {
                AesGcmBox.open(wrappingKey(), it, key.toByteArray(Charsets.UTF_8))
            }

        @Synchronized override fun put(
            key: String,
            value: ByteArray,
        ) {
            val entries = read()
            entries[key] = AesGcmBox.seal(wrappingKey(), value, key.toByteArray(Charsets.UTF_8))
            persist(entries)
        }

        @Synchronized override fun remove(key: String) {
            val entries = read()
            entries.remove(key)
            persist(entries)
        }

        @Synchronized override fun clear() {
            file.delete()
            if (keyStore.containsAlias(ALIAS)) keyStore.deleteEntry(ALIAS)
        }

        private fun read(): MutableMap<String, SealedBox> {
            if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return mutableMapOf()
            return DataInputStream(file.openRead()).use { input ->
                check(input.readInt() == VERSION)
                val count = input.readInt()
                require(count in 0..MAX_ENTRIES)
                buildMap {
                    repeat(count) {
                        val name = input.readUTF()
                        val iv = ByteArray(AesGcmBox.IV_BYTES).also { input.readFully(it) }
                        val length = input.readInt()
                        require(length in 1..MAX_BLOB)
                        put(name, SealedBox(iv, ByteArray(length).also { input.readFully(it) }))
                    }
                }.toMutableMap()
            }
        }

        private fun persist(entries: Map<String, SealedBox>) {
            val stream = file.startWrite()
            try {
                val output = DataOutputStream(stream)
                output.writeInt(VERSION)
                output.writeInt(entries.size)
                entries.toSortedMap().forEach { (name, box) ->
                    output.writeUTF(name)
                    output.write(box.iv)
                    output.writeInt(box.ciphertext.size)
                    output.write(box.ciphertext)
                }
                output.flush()
                file.finishWrite(stream)
            } catch (exception: java.io.IOException) {
                file.failWrite(stream)
                throw exception
            }
        }

        private companion object {
            const val KEY_BITS = 256
            const val ALIAS = "cetele.vault"
            const val VERSION = 1
            const val MAX_ENTRIES = 32
            const val MAX_BLOB = 65536
        }
    }
