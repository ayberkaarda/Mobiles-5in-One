package app.cetele.server.reminders.delivery

import java.net.InetAddress

/**
 * Comma separated IPv4 and IPv6 addresses or CIDR blocks. An empty list allows every address
 * (the signature is the control, this is defence in depth). Only address literals are accepted,
 * so no lookup ever happens.
 */
class IpAllowlist private constructor(
    private val blocks: List<Block>,
) {
    val isEmpty: Boolean get() = blocks.isEmpty()

    fun allows(address: String): Boolean {
        if (blocks.isEmpty()) return true
        val bytes = literal(address.trim()) ?: return false
        return blocks.any { it.contains(bytes) }
    }

    private class Block(
        val network: ByteArray,
        val prefixBits: Int,
    ) {
        fun contains(candidate: ByteArray): Boolean {
            if (candidate.size != network.size) return false
            val fullBytes = prefixBits / 8
            for (i in 0 until fullBytes) if (candidate[i] != network[i]) return false
            val rest = prefixBits % 8
            if (rest == 0) return true
            val mask = (0xFF shl (8 - rest)) and 0xFF
            return (candidate[fullBytes].toInt() and mask) == (network[fullBytes].toInt() and mask)
        }
    }

    companion object {
        private val IPV4 = Regex("""[0-9]{1,3}(\.[0-9]{1,3}){3}""")
        private val IPV6 = Regex("""[0-9A-Fa-f:.]{2,45}""")

        fun parse(value: String): IpAllowlist {
            val entries = value.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            return IpAllowlist(entries.map { block(it) })
        }

        private fun block(entry: String): Block {
            val address = entry.substringBefore('/')
            val bytes = requireNotNull(literal(address)) { "CETELE_SMS_DLR_ALLOWED_IPS has an entry that is not an IP address" }
            val max = bytes.size * 8
            val prefix =
                if (entry.contains('/')) {
                    requireNotNull(entry.substringAfter('/').toIntOrNull()) { "CETELE_SMS_DLR_ALLOWED_IPS has an invalid prefix length" }
                } else {
                    max
                }
            require(prefix in 0..max) { "CETELE_SMS_DLR_ALLOWED_IPS has an invalid prefix length" }
            return Block(bytes, prefix)
        }

        private fun literal(text: String): ByteArray? {
            val shaped = IPV4.matches(text) || (text.contains(':') && IPV6.matches(text))
            if (!shaped) return null
            return try {
                InetAddress.getByName(text).address
            } catch (_: java.net.UnknownHostException) {
                null
            }
        }
    }
}
