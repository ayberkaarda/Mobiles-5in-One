package app.cetele.android.core.data.vault

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class SealedBox(
    val iv: ByteArray,
    val ciphertext: ByteArray,
)

object AesGcmBox {
    const val IV_BYTES = 12
    const val TAG_BITS = 128

    fun seal(
        key: SecretKey,
        plaintext: ByteArray,
        aad: ByteArray,
    ): SealedBox {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, SecureRandom())
        cipher.updateAAD(aad)
        val iv = cipher.iv
        check(iv.size == IV_BYTES)
        return SealedBox(iv, cipher.doFinal(plaintext))
    }

    fun open(
        key: SecretKey,
        box: SealedBox,
        aad: ByteArray,
    ): ByteArray = cipher(Cipher.DECRYPT_MODE, key, box.iv, aad).doFinal(box.ciphertext)

    private fun cipher(
        mode: Int,
        key: SecretKey,
        iv: ByteArray,
        aad: ByteArray,
    ): Cipher {
        require(iv.size == IV_BYTES)
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(mode, key, GCMParameterSpec(TAG_BITS, iv))
            updateAAD(aad)
        }
    }
}
