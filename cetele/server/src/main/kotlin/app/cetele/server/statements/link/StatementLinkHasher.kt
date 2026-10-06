package app.cetele.server.statements.link

import org.springframework.stereotype.Component
import java.security.MessageDigest
import java.util.HexFormat

@Component
class StatementLinkHasher {
    fun hash(token: String): String =
        HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)))
}
