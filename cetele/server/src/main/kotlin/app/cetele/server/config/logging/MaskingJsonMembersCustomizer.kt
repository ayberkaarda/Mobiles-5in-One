package app.cetele.server.config.logging

import ch.qos.logback.classic.spi.ILoggingEvent
import org.springframework.boot.json.JsonWriter
import org.springframework.boot.logging.structured.StructuredLoggingJsonMembersCustomizer

/**
 * Applies [Masking] to every string value of a structured (ECS) log event: message, MDC values,
 * key-value pairs, error message and stack trace. Registered through
 * `logging.structured.json.customizer`.
 */
class MaskingJsonMembersCustomizer : StructuredLoggingJsonMembersCustomizer<ILoggingEvent> {
    override fun customize(members: JsonWriter.Members<ILoggingEvent>) {
        members.applyingValueProcessor(
            JsonWriter.ValueProcessor.of(CharSequence::class.java) { value -> Masking.mask(value.toString()) },
        )
    }
}
