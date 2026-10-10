package app.cetele.android.core.data.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import app.cetele.android.core.data.database.entity.OutboxEntity
import kotlinx.coroutines.flow.Flow

// A DAO is the catalogue of its table's queries; splitting it would only scatter them.
@Suppress("TooManyFunctions")
@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(row: OutboxEntity)

    @Upsert suspend fun upsert(row: OutboxEntity)

    @Query(
        """
            SELECT * FROM outbox_operations WHERE shop_id = :shopId AND state = 'QUEUED' ORDER BY
            client_seq IS NULL, client_seq, created_at, client_id LIMIT :limit
        """,
    )
    suspend fun queued(
        shopId: String,
        limit: Int,
    ): List<OutboxEntity>

    @Query("SELECT * FROM outbox_operations WHERE shop_id = :shopId AND client_id = :clientId")
    suspend fun get(
        shopId: String,
        clientId: String,
    ): OutboxEntity?

    @Query(
        """
            SELECT * FROM outbox_operations WHERE shop_id = :shopId AND entity_id = :entityId ORDER BY
            created_at, client_id
        """,
    )
    suspend fun forEntity(
        shopId: String,
        entityId: String,
    ): List<OutboxEntity>

    @Query(
        """
            UPDATE outbox_operations SET client_seq = :seq WHERE shop_id = :shopId AND client_id =
            :clientId AND client_seq IS NULL
        """,
    )
    suspend fun assignSeq(
        shopId: String,
        clientId: String,
        seq: Long,
    )

    @Query("DELETE FROM outbox_operations WHERE shop_id = :shopId AND client_id = :clientId")
    suspend fun delete(
        shopId: String,
        clientId: String,
    )

    @Query(
        """
            UPDATE outbox_operations SET state = 'REJECTED', last_code = :code, errors_json = :errors,
            updated_at = :at WHERE shop_id = :shopId AND client_id = :clientId
        """,
    )
    suspend fun markRejected(
        shopId: String,
        clientId: String,
        code: String?,
        errors: String?,
        at: String,
    )

    @Query(
        """
            UPDATE outbox_operations SET state = 'BLOCKED', last_code = :code, updated_at = :at WHERE
            shop_id = :shopId AND client_id = :clientId
        """,
    )
    suspend fun markBlocked(
        shopId: String,
        clientId: String,
        code: String?,
        at: String,
    )

    @Query(
        """
            UPDATE outbox_operations SET state = 'QUEUED', last_code = NULL, updated_at = :at WHERE
            shop_id = :shopId AND photo_entry_id = :entryId AND state = 'BLOCKED' AND last_code IS
            NULL
        """,
    )
    suspend fun unblockForPhoto(
        shopId: String,
        entryId: String,
        at: String,
    )

    @Query(
        """
            SELECT * FROM outbox_operations WHERE shop_id = :shopId AND state IN ('REJECTED',
            'BLOCKED') ORDER BY created_at, client_id
        """,
    )
    fun observeIssues(shopId: String): Flow<List<OutboxEntity>>

    @Query("SELECT COUNT(*) FROM outbox_operations WHERE shop_id = :shopId AND state != 'REJECTED'")
    suspend fun countPending(shopId: String): Int

    @Query("DELETE FROM outbox_operations WHERE shop_id = :shopId")
    suspend fun deleteShop(shopId: String)
}
