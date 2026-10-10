package app.cetele.android.core.data.repository

import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.database.entity.ReminderLogEntity
import app.cetele.android.core.domain.id.UuidV7
import kotlinx.coroutines.flow.Flow
import java.time.Clock
import java.time.Instant
import javax.inject.Inject

interface ReminderLogRepository {
    fun observeLast(
        shopId: String,
        customerId: String,
    ): Flow<ReminderLogEntity?>

    suspend fun record(
        shopId: String,
        customerId: String,
        reminder: ReminderRecord,
    )
}

/** One reminder sent from this device; [channel] is `WHATSAPP` or `SMS`, quota fields only for SMS. */
data class ReminderRecord(
    val channel: String,
    val sentAt: Instant,
    val status: String,
    val quotaUsed: Int? = null,
    val quotaLimit: Int? = null,
)

class RoomReminderLogRepository
    @Inject
    constructor(
        private val databases: DatabaseStore,
        private val clock: Clock,
    ) : ReminderLogRepository {
        override fun observeLast(
            shopId: String,
            customerId: String,
        ): Flow<ReminderLogEntity?> = databases.get().reminderLogDao().observeLast(shopId, customerId)

        override suspend fun record(
            shopId: String,
            customerId: String,
            reminder: ReminderRecord,
        ) {
            require(reminder.channel in setOf("WHATSAPP", "SMS"))
            databases.get().reminderLogDao().insert(
                ReminderLogEntity(
                    UuidV7.generate(clock),
                    shopId,
                    customerId,
                    reminder.channel,
                    reminder.sentAt.toString(),
                    reminder.status,
                    reminder.quotaUsed,
                    reminder.quotaLimit,
                ),
            )
        }
    }
