package app.cetele.server.config.logging

import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.pattern.CompositeConverter

/**
 * Logback composite converter `%mask(...)` for the plain `local` console pattern: masks the
 * rendered text of its child pattern (message, MDC, key-value pairs and stack trace).
 */
class MaskingConverter : CompositeConverter<ILoggingEvent>() {
    // Public so that the masking of a rendered line can be checked without a logback setup.
    public override fun transform(
        event: ILoggingEvent,
        input: String?,
    ): String = Masking.mask(input) ?: ""
}
