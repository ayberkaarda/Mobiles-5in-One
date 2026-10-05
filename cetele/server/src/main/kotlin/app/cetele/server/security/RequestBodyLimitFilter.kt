package app.cetele.server.security

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import app.cetele.server.web.problem.ProblemWriter
import jakarta.servlet.FilterChain
import jakarta.servlet.ReadListener
import jakarta.servlet.ServletInputStream
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpHeaders
import org.springframework.http.InvalidMediaTypeException
import org.springframework.http.MediaType
import org.springframework.web.filter.OncePerRequestFilter

/**
 * Request body guard for the whole server:
 * - bodies larger than [maxBytes] (1 MB) end with 413, whether announced by `Content-Length`
 *   or discovered while streaming a chunked body;
 * - on the `/v1/` API a request body must be JSON (`application/json` or `+json`); anything else,
 *   multipart included, ends with 415.
 */
class RequestBodyLimitFilter(
    private val problems: ProblemWriter,
    private val maxBytes: Long = MAX_BODY_BYTES,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        if (request.contentLengthLong > maxBytes) {
            problems.write(request, response, ProblemCode.PAYLOAD_TOO_LARGE)
            return
        }
        if (isApi(request) && hasBody(request) && !isJson(request.contentType)) {
            problems.write(request, response, ProblemCode.UNSUPPORTED_MEDIA_TYPE)
            return
        }
        filterChain.doFilter(LimitedRequest(request, maxBytes), response)
    }

    private fun isApi(request: HttpServletRequest): Boolean = request.requestURI.removePrefix(request.contextPath).startsWith("/v1/")

    private fun hasBody(request: HttpServletRequest): Boolean =
        request.contentLengthLong > 0 || request.getHeader(HttpHeaders.TRANSFER_ENCODING) != null

    private fun isJson(contentType: String?): Boolean {
        if (contentType.isNullOrBlank()) return false
        val type =
            try {
                MediaType.parseMediaType(contentType)
            } catch (_: InvalidMediaTypeException) {
                return false
            }
        return type.type == "application" && (type.subtype == "json" || type.subtype.endsWith("+json"))
    }

    private class LimitedRequest(
        request: HttpServletRequest,
        private val maxBytes: Long,
    ) : HttpServletRequestWrapper(request) {
        private val stream by lazy { LimitedInputStream(request.inputStream, maxBytes) }

        override fun getInputStream(): ServletInputStream = stream
    }

    private class LimitedInputStream(
        private val delegate: ServletInputStream,
        private val maxBytes: Long,
    ) : ServletInputStream() {
        private var count = 0L

        override fun read(): Int {
            val value = delegate.read()
            if (value >= 0) count(1)
            return value
        }

        override fun read(
            b: ByteArray,
            off: Int,
            len: Int,
        ): Int {
            val read = delegate.read(b, off, len)
            if (read > 0) count(read.toLong())
            return read
        }

        private fun count(bytes: Long) {
            count += bytes
            if (count > maxBytes) throw ProblemException(ProblemCode.PAYLOAD_TOO_LARGE, "request body over the limit")
        }

        override fun isFinished(): Boolean = delegate.isFinished

        override fun isReady(): Boolean = delegate.isReady

        override fun setReadListener(readListener: ReadListener) = delegate.setReadListener(readListener)
    }

    companion object {
        const val MAX_BODY_BYTES: Long = 1024L * 1024L
    }
}
