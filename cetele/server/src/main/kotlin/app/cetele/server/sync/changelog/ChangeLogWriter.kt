package app.cetele.server.sync.changelog

import app.cetele.server.security.TraceIdFilter
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

@Component
class ChangeLogWriter(
    private val sequence: ShopSequence,
    private val rows: ChangeLogRepository,
    private val clock: Clock,
) {
    @Transactional(propagation = Propagation.MANDATORY)
    fun append(
        shopId: UUID,
        entity: String,
        entityId: UUID,
        op: String,
        payloadJson: String,
    ) {
        rows.save(ChangeLogRow(TraceIdFilter.uuidV7(), shopId, sequence.next(shopId), entity, entityId, op, payloadJson, clock.instant()))
    }
}
