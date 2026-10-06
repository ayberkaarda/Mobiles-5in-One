package app.cetele.server.sync.changelog

import app.cetele.server.sync.ChangeView
import app.cetele.server.sync.CustomerView
import app.cetele.server.sync.EntryView
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.ObjectMapper
import java.util.UUID

@Component
class ChangeLogReader(
    private val rows: ChangeLogRepository,
    private val mapper: ObjectMapper,
) {
    @Transactional(readOnly = true)
    fun after(
        shopId: UUID,
        since: Long,
        limit: Int,
    ): List<ChangeView> =
        rows.after(shopId, since, limit).map { row ->
            val payload: Any =
                when (row.entity) {
                    "CUSTOMER" -> mapper.readValue(row.payload, CustomerView::class.java)
                    "ENTRY" -> mapper.readValue(row.payload, EntryView::class.java)
                    else -> error("unknown change entity")
                }
            ChangeView(row.seq, row.entity, row.entityId, row.op, row.at, payload)
        }
}
