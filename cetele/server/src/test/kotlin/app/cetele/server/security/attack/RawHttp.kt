package app.cetele.server.security.attack

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.security.SecureRandom

/**
 * A minimal HTTP/1.1 client over a raw socket, so the attack suite controls everything a real
 * attacker controls: the source address of the TCP connection (any `127.0.0.x` loopback address),
 * `X-Forwarded-For`, `Content-Length` versus chunked bodies, and bytes that are not valid JSON or
 * UTF-8. Every request uses `Connection: close`; the response is read to the end of the stream.
 *
 * Only [TRUSTED_PROXY] is a trusted proxy in the attack context, so a request from it with a
 * random `X-Forwarded-For` behaves like a request from a distinct client on the internet. Any other
 * peer is an untrusted client whose `X-Forwarded-For` must be ignored.
 */
class RawHttp(
    private val port: Int,
) {
    class Response(
        val status: Int,
        private val headerMap: Map<String, List<String>>,
        val body: ByteArray,
    ) {
        val text: String get() = body.toString(Charsets.UTF_8)

        fun header(name: String): String? = headerMap[name.lowercase()]?.firstOrNull()

        fun headers(name: String): List<String> = headerMap[name.lowercase()].orEmpty()

        override fun toString(): String = "HTTP $status ${text.take(MAX_PREVIEW)}"
    }

    @Suppress("LongParameterList")
    fun exchange(
        method: String,
        path: String,
        headers: Map<String, String> = emptyMap(),
        body: ByteArray? = null,
        peer: String = TRUSTED_PROXY,
        forwardedFor: String? = randomClient(),
        chunked: Boolean = false,
    ): Response {
        val head = StringBuilder()
        head.append("$method $path HTTP/1.1\r\n")
        head.append("Host: 127.0.0.1:$port\r\n")
        head.append("Connection: close\r\n")
        if (forwardedFor != null) head.append("X-Forwarded-For: $forwardedFor\r\n")
        headers.forEach { (name, value) -> head.append("$name: $value\r\n") }
        if (body != null) {
            if (chunked) head.append("Transfer-Encoding: chunked\r\n") else head.append("Content-Length: ${body.size}\r\n")
        }
        head.append("\r\n")
        Socket().use { socket ->
            socket.bind(InetSocketAddress(InetAddress.getByName(peer), 0))
            socket.connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), TIMEOUT_MS)
            socket.soTimeout = TIMEOUT_MS
            val output = socket.getOutputStream()
            try {
                output.write(head.toString().toByteArray(Charsets.UTF_8))
                if (body != null) {
                    if (chunked) writeChunked(output, body) else output.write(body)
                }
                output.flush()
            } catch (_: IOException) {
                // The server may answer and close before the whole body is written (413); read what it sent.
            }
            val raw = readAll(socket)
            return parse(raw)
        }
    }

    private fun writeChunked(
        output: java.io.OutputStream,
        body: ByteArray,
    ) {
        var offset = 0
        while (offset < body.size) {
            val size = minOf(CHUNK, body.size - offset)
            output.write((Integer.toHexString(size) + "\r\n").toByteArray(Charsets.US_ASCII))
            output.write(body, offset, size)
            output.write("\r\n".toByteArray(Charsets.US_ASCII))
            offset += size
        }
        output.write("0\r\n\r\n".toByteArray(Charsets.US_ASCII))
    }

    private fun readAll(socket: Socket): ByteArray {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(CHUNK)
        try {
            val input = socket.getInputStream()
            while (true) {
                val read = input.read(chunk)
                if (read < 0) break
                buffer.write(chunk, 0, read)
            }
        } catch (exception: IOException) {
            if (buffer.size() == 0) throw exception
        }
        return buffer.toByteArray()
    }

    private fun parse(raw: ByteArray): Response {
        val split = indexOf(raw, HEADER_END)
        check(split >= 0) { "no complete response head in ${raw.size} bytes" }
        val lines = String(raw, 0, split, Charsets.ISO_8859_1).split("\r\n")
        val status = lines.first().split(" ")[1].toInt()
        val headers = mutableMapOf<String, MutableList<String>>()
        lines.drop(1).forEach { line ->
            headers.getOrPut(line.substringBefore(":").trim().lowercase()) { mutableListOf() } += line.substringAfter(":").trim()
        }
        var body = raw.copyOfRange(split + HEADER_END.size, raw.size)
        if (headers["transfer-encoding"]?.any { it.equals("chunked", ignoreCase = true) } == true) {
            body = dechunk(body)
        } else {
            headers["content-length"]?.firstOrNull()?.toIntOrNull()?.let { length ->
                if (length < body.size) body = body.copyOf(length)
            }
        }
        return Response(status, headers, body)
    }

    private fun dechunk(body: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        var position = 0
        while (position < body.size) {
            val lineEnd = indexOf(body, CRLF, position)
            if (lineEnd < 0) break
            val size = String(body, position, lineEnd - position, Charsets.US_ASCII).substringBefore(';').trim().toInt(HEX)
            if (size == 0) break
            val start = lineEnd + CRLF.size
            out.write(body, start, minOf(size, body.size - start))
            position = start + size + CRLF.size
        }
        return out.toByteArray()
    }

    private fun indexOf(
        data: ByteArray,
        pattern: ByteArray,
        from: Int = 0,
    ): Int {
        outer@ for (i in from..data.size - pattern.size) {
            for (j in pattern.indices) if (data[i + j] != pattern[j]) continue@outer
            return i
        }
        return -1
    }

    companion object {
        /** The only peer the attack context trusts as a reverse proxy. */
        const val TRUSTED_PROXY = "127.0.0.2"
        private const val TIMEOUT_MS = 30_000
        private const val CHUNK = 8 * 1024
        private const val HEX = 16
        private const val MAX_PREVIEW = 400
        private val HEADER_END = "\r\n\r\n".toByteArray(Charsets.US_ASCII)
        private val CRLF = "\r\n".toByteArray(Charsets.US_ASCII)
        private val random = SecureRandom()

        /** A client address in 10.0.0.0/8, random per call. */
        fun randomClient(): String = "10." + (1..3).joinToString(".") { random.nextInt(256).toString() }
    }
}
