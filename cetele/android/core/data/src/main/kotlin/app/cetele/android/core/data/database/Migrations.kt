package app.cetele.android.core.data.database

import androidx.room.migration.Migration
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.execSQL

object Migrations {
    val MIGRATION_1_2: Migration =
        object : Migration(1, 2) {
            override fun migrate(connection: SQLiteConnection) {
                statements.forEach { connection.execSQL(it) }
            }

            override fun migrate(db: SupportSQLiteDatabase) {
                statements.forEach { db.execSQL(it) }
            }
        }
    private val statements: List<String> =
        listOf(
            """
                CREATE TABLE IF NOT EXISTS `shops` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, `type` TEXT
                NOT NULL, `il` TEXT NOT NULL, `ilce` TEXT NOT NULL, `plan` TEXT NOT NULL, `role` TEXT NOT
                NULL, `created_at` TEXT NOT NULL, `refreshed_at` TEXT NOT NULL, PRIMARY KEY(`id`))
            """,
            """
                CREATE TABLE IF NOT EXISTS `customers` (`id` TEXT NOT NULL, `shop_id` TEXT NOT NULL,
                `name` TEXT NOT NULL, `search_key` TEXT NOT NULL, `phone` TEXT, `note` TEXT, `tag` TEXT,
                `sms_consent` INTEGER NOT NULL, `sms_consent_at` TEXT, `sms_consent_source` TEXT,
                `created_at` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `deleted_at` TEXT, `sync_state`
                TEXT NOT NULL, PRIMARY KEY(`id`))
            """,
            """
                CREATE INDEX IF NOT EXISTS `index_customers_shop_id_deleted_at_search_key` ON `customers`
                (`shop_id`, `deleted_at`, `search_key`)
            """,
            "CREATE INDEX IF NOT EXISTS `index_customers_shop_id_updated_at` ON `customers` (`shop_id`, `updated_at`)",
            """
                CREATE TABLE IF NOT EXISTS `ledger_entries` (`id` TEXT NOT NULL, `shop_id` TEXT NOT NULL,
                `customer_id` TEXT NOT NULL, `type` TEXT NOT NULL, `amount_minor` INTEGER NOT NULL,
                `currency` TEXT NOT NULL, `occurred_on` TEXT NOT NULL, `due_on` TEXT, `note` TEXT,
                `photo_key` TEXT, `reverses` TEXT, `reversed_by` TEXT, `created_by` TEXT, `created_at`
                TEXT NOT NULL, `sync_state` TEXT NOT NULL, PRIMARY KEY(`id`))
            """,
            """
                CREATE INDEX IF NOT EXISTS
                `index_ledger_entries_shop_id_customer_id_occurred_on_created_at` ON `ledger_entries`
                (`shop_id`, `customer_id`, `occurred_on`, `created_at`)
            """,
            """
                CREATE INDEX IF NOT EXISTS `index_ledger_entries_shop_id_occurred_on` ON `ledger_entries`
                (`shop_id`, `occurred_on`)
            """,
            """
                CREATE INDEX IF NOT EXISTS `index_ledger_entries_shop_id_due_on` ON `ledger_entries`
                (`shop_id`, `due_on`)
            """,
            """
                CREATE TABLE IF NOT EXISTS `outbox_operations` (`client_id` TEXT NOT NULL, `shop_id` TEXT
                NOT NULL, `kind` TEXT NOT NULL, `entity_id` TEXT NOT NULL, `payload_json` TEXT NOT NULL,
                `created_at` TEXT NOT NULL, `client_seq` INTEGER, `depends_on_client_id` TEXT,
                `photo_entry_id` TEXT, `state` TEXT NOT NULL, `attempts` INTEGER NOT NULL, `last_code`
                TEXT, `errors_json` TEXT, `updated_at` TEXT NOT NULL, PRIMARY KEY(`client_id`))
            """,
            """
                CREATE UNIQUE INDEX IF NOT EXISTS `index_outbox_operations_shop_id_client_seq` ON
                `outbox_operations` (`shop_id`, `client_seq`)
            """,
            """
                CREATE INDEX IF NOT EXISTS `index_outbox_operations_shop_id_state_created_at` ON
                `outbox_operations` (`shop_id`, `state`, `created_at`)
            """,
            """
                CREATE TABLE IF NOT EXISTS `pending_photos` (`entry_id` TEXT NOT NULL, `shop_id` TEXT NOT
                NULL, `local_path` TEXT NOT NULL, `content_length` INTEGER NOT NULL, `media_id` TEXT,
                `photo_key` TEXT, `state` TEXT NOT NULL, `attempts` INTEGER NOT NULL, `last_code` TEXT,
                `created_at` TEXT NOT NULL, `updated_at` TEXT NOT NULL, PRIMARY KEY(`entry_id`))
            """,
            "CREATE INDEX IF NOT EXISTS `index_pending_photos_shop_id_state` ON `pending_photos` (`shop_id`, `state`)",
            """
                CREATE TABLE IF NOT EXISTS `reminder_log` (`id` TEXT NOT NULL, `shop_id` TEXT NOT NULL,
                `customer_id` TEXT NOT NULL, `channel` TEXT NOT NULL, `sent_at` TEXT NOT NULL, `status`
                TEXT NOT NULL, `quota_used` INTEGER, `quota_limit` INTEGER, PRIMARY KEY(`id`))
            """,
            """
                CREATE INDEX IF NOT EXISTS `index_reminder_log_shop_id_customer_id_sent_at` ON
                `reminder_log` (`shop_id`, `customer_id`, `sent_at`)
            """,
            "ALTER TABLE sync_cursor ADD COLUMN next_client_seq INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE sync_cursor ADD COLUMN last_push_at TEXT",
            "ALTER TABLE sync_cursor ADD COLUMN last_pull_at TEXT",
            "ALTER TABLE sync_cursor ADD COLUMN last_error_code TEXT",
        )
}
