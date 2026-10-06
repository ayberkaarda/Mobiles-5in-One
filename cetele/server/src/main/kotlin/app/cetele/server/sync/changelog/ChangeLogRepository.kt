package app.cetele.server.sync.changelog

import app.cetele.server.tenancy.TenantRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.util.UUID

interface ChangeLogRepository : TenantRepository<ChangeLogRow> {
    @Query(value = "SELECT * FROM change_log WHERE shop_id = :shopId AND seq > :since ORDER BY seq LIMIT :limit", nativeQuery = true)
    fun after(
        @Param("shopId") shopId: UUID,
        @Param("since") since: Long,
        @Param("limit") limit: Int,
    ): List<ChangeLogRow>
}
