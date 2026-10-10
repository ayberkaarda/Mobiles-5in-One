package app.cetele.server.admin.audit

import app.cetele.server.admin.AuditProperties
import app.cetele.server.admin.console.ConsoleFormat
import app.cetele.server.config.ClientIp
import app.cetele.server.config.LocalOnlyAdapterGuard
import app.cetele.server.security.TraceIdFilter
import org.slf4j.LoggerFactory
import org.springframework.core.env.Environment
import org.springframework.data.domain.PageRequest
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes
import tools.jackson.databind.ObjectMapper
import java.security.SecureRandom
import java.time.Clock
import java.time.Instant
import java.util.Base64
import java.util.HexFormat
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * `ip_hash = lowercase_hex(HMAC-SHA256(CETELE_AUDIT_IP_KEY, ip))`. An empty key is the local-only
 * stand-in `ephemeral-audit-ip-key` (random per start).
 */
@Component
class AuditIpHasher(
    properties: AuditProperties,
    environment: Environment,
) {
    private val key: ByteArray = resolveKey(properties.ipKey, environment)

    fun hash(ip: String): String {
        val mac = Mac.getInstance(ALGORITHM).apply { init(SecretKeySpec(key, ALGORITHM)) }
        return HexFormat.of().formatHex(mac.doFinal(ip.toByteArray(Charsets.UTF_8)))
    }

    companion object {
        const val EPHEMERAL_ADAPTER = "ephemeral-audit-ip-key"
        private const val ALGORITHM = "HmacSHA256"
        private const val MIN_KEY_BYTES = 32
        private val log = LoggerFactory.getLogger(AuditIpHasher::class.java)

        fun resolveKey(
            configured: String,
            environment: Environment,
        ): ByteArray {
            if (configured.isBlank()) {
                LocalOnlyAdapterGuard.check(EPHEMERAL_ADAPTER, environment)
                log.warn("Using an ephemeral audit ip key; ip hashes do not survive a restart")
                return ByteArray(MIN_KEY_BYTES).also { SecureRandom().nextBytes(it) }
            }
            val decoded =
                runCatching { Base64.getDecoder().decode(configured.trim()) }
                    .getOrElse { throw IllegalStateException("CETELE_AUDIT_IP_KEY is not standard Base64") }
            check(decoded.size >= MIN_KEY_BYTES) { "CETELE_AUDIT_IP_KEY must hold at least 32 bytes" }
            return decoded
        }
    }
}

/** A row of the audit page: only what the table shows. */
data class AuditRowView(
    val at: String,
    val actorType: String,
    val actorId: UUID?,
    val action: String,
    val targetType: String?,
    val targetId: UUID?,
    val metadata: String,
)

data class AuditPage(
    val rows: List<AuditRowView>,
    val page: Int,
    val hasNext: Boolean,
)

/**
 * Writes `audit_logs` rows. [record] joins the caller's transaction (MANDATORY), so the row and
 * the action it records commit or fail together; the client address and trace id come from the
 * current request.
 */
@Service
class AuditLogService(
    private val rows: AuditLogRepository,
    private val ipHasher: AuditIpHasher,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    @Transactional(propagation = Propagation.MANDATORY)
    fun record(
        actorType: AuditActorType,
        actorId: UUID?,
        action: AuditAction,
        targetType: AuditTargetType? = null,
        targetId: UUID? = null,
        metadata: Map<String, Any> = emptyMap(),
    ): AuditLog {
        require((targetType == null) == (targetId == null)) { "target type and id go together" }
        val unknown = metadata.keys - action.metadataKeys
        require(unknown.isEmpty()) { "metadata keys $unknown are not allowed for $action" }
        metadata.values.forEach { value ->
            require(value is Number || value is Boolean || value is Enum<*> || value is Instant) {
                "metadata of $action holds only numbers, booleans, enum names and instants"
            }
        }
        // A SYSTEM row (startup, jobs) has no client and no request trace.
        val request =
            if (actorType ==
                AuditActorType.ADMIN
            ) {
                (RequestContextHolder.getRequestAttributes() as? ServletRequestAttributes)?.request
            } else {
                null
            }
        val json =
            mapper.writeValueAsString(
                metadata.mapValues { (_, value) ->
                    if (value is Enum<*> ||
                        value is Instant
                    ) {
                        value.toString()
                    } else {
                        value
                    }
                },
            )
        return rows.save(
            AuditLog(
                at = clock.instant(),
                actorType = actorType,
                actorId = actorId,
                action = action.name,
                targetType = targetType,
                targetId = targetId,
                ipHash = request?.let { ipHasher.hash(ClientIp.of(it)) },
                traceId = request?.let { TraceIdFilter.current(it) }?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                metadata = json,
            ),
        )
    }

    /** One page of the log, newest first, for an `ADMIN`; the view itself is audited (`page`). */
    @Transactional
    fun view(
        actorId: UUID,
        page: Int,
    ): AuditPage {
        val safePage = page.coerceIn(0, MAX_PAGE)
        val found = rows.findPage(PageRequest.of(safePage, PAGE_SIZE))
        val views =
            found.content.map {
                AuditRowView(
                    ConsoleFormat.time(it.at),
                    it.actorType.name,
                    it.actorId,
                    it.action,
                    it.targetType?.name,
                    it.targetId,
                    it.metadata,
                )
            }
        record(AuditActorType.ADMIN, actorId, AuditAction.AUDIT_LOG_VIEWED, metadata = mapOf("page" to safePage))
        return AuditPage(views, safePage, found.hasNext())
    }

    companion object {
        const val PAGE_SIZE = 50
        const val MAX_PAGE = 100_000
    }
}
