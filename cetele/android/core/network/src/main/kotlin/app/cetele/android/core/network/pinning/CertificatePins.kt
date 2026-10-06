package app.cetele.android.core.network.pinning

import java.util.Base64

data class CertificatePins(
    val enabled: Boolean,
    val pins: List<String> = emptyList(),
) {
    init {
        require(!enabled || pins.distinct().size >= 2) { "Pinning needs a primary and a backup pin" }
        require(pins.all(::isValid)) { "Certificate pins must contain SHA-256 SPKI digests" }
    }

    companion object {
        fun parse(
            enabled: Boolean,
            value: String,
        ): CertificatePins = CertificatePins(enabled, value.split(',').map(String::trim).filter(String::isNotEmpty))

        private const val SHA256_BYTES = 32

        fun isValid(pin: String): Boolean =
            pin.startsWith("sha256/") &&
                runCatching {
                    val digest = pin.removePrefix("sha256/")
                    val bytes = Base64.getDecoder().decode(digest)
                    bytes.size == SHA256_BYTES && Base64.getEncoder().encodeToString(bytes) == digest
                }.getOrDefault(false)
    }
}
