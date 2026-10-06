package app.cetele.android.core.data.lock

import app.cetele.android.core.domain.validation.Limits
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import javax.inject.Inject

class PinHasher
    @Inject
    constructor() {
        fun hash(
            pin: CharArray,
            salt: ByteArray,
        ): ByteArray {
            require(pin.size == Limits.PIN_LENGTH && pin.all { it in '0'..'9' })
            require(salt.size == SALT_BYTES)
            val parameters =
                Argon2Parameters
                    .Builder(Argon2Parameters.ARGON2_id)
                    .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                    .withMemoryAsKB(MEMORY_KIB)
                    .withIterations(ITERATIONS)
                    .withParallelism(PARALLELISM)
                    .withSalt(salt)
                    .build()
            return ByteArray(HASH_BYTES).also { bytes ->
                Argon2BytesGenerator().apply {
                    init(parameters)
                    generateBytes(pin, bytes)
                }
            }
        }

        companion object {
            const val MEMORY_KIB = 32768
            const val ITERATIONS = 3
            const val PARALLELISM = 1
            const val SALT_BYTES = 16
            const val HASH_BYTES = 32
        }
    }
