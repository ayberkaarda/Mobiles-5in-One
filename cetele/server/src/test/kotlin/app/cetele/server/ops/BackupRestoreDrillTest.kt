package app.cetele.server.ops

import app.cetele.server.ledger.money.Balance
import app.cetele.server.ledger.money.BalanceLine
import app.cetele.server.support.PostgresTestConfiguration
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.MountableFile
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.sql.Connection
import java.sql.DriverManager
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * Restore drill in Testcontainers (security checklist item 20, docs/ops/backup-restore.md).
 *
 * A source PostgreSQL 16 gets the Flyway migrations and the synthetic drill data of
 * `ops/backup/drill-seed.sql`; `pg_dump -Fc` runs in the source container and `pg_restore` into a
 * new database of a second, fresh container. Both sides are fingerprinted with
 * `ops/backup/drill-stats.sql` and the restored side is checked with
 * `ops/backup/drill-invariants.sql`: the same SQL files the shell drill runs, read from the
 * repository. The age encryption and the bucket are not part of this test; drill-e2e.sh covers
 * them against MinIO.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class BackupRestoreDrillTest {
    private val source = PostgreSQLContainer(PostgresTestConfiguration.POSTGRES_IMAGE)
    private val target = PostgreSQLContainer(PostgresTestConfiguration.POSTGRES_IMAGE)
    private lateinit var restoredUrl: String
    private lateinit var sourceFingerprint: List<String>

    @BeforeAll
    fun backUpAndRestore() {
        source.start()
        target.start()
        Flyway
            .configure()
            .dataSource(source.jdbcUrl, source.username, source.password)
            .locations("classpath:db/migration")
            .load()
            .migrate()
        connect(source.jdbcUrl, source).use { it.createStatement().use { statement -> statement.execute(opsSql("drill-seed.sql")) } }
        sourceFingerprint = connect(source.jdbcUrl, source).use { lines(it, opsSql("drill-stats.sql")) }

        exec(source, "pg_dump", "-Fc", "-U", source.username, "-d", source.databaseName, "-f", DUMP_PATH)
        val hostDump = Files.createTempFile("cetele-drill", ".dump")
        try {
            source.copyFileFromContainer(DUMP_PATH, hostDump.toString())
            assertTrue(Files.size(hostDump) > 0, "pg_dump wrote an empty file")
            target.copyFileToContainer(MountableFile.forHostPath(hostDump), DUMP_PATH)
        } finally {
            Files.deleteIfExists(hostDump)
        }
        exec(
            target,
            "psql",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            target.username,
            "-d",
            target.databaseName,
            "-c",
            "CREATE DATABASE restored TEMPLATE template0",
        )
        exec(target, "pg_restore", "--no-owner", "--exit-on-error", "-U", target.username, "-d", "restored", DUMP_PATH)
        restoredUrl = "jdbc:postgresql://${target.host}:${target.getMappedPort(POSTGRES_PORT)}/restored"
    }

    @AfterAll
    fun stopContainers() {
        target.stop()
        source.stop()
    }

    @Test
    fun `the restored database has the row counts and ledger balance checksum of the source`() {
        val restored = connect(restoredUrl, target).use { lines(it, opsSql("drill-stats.sql")) }
        assertEquals(sourceFingerprint, restored)
        assertTrue("rows ledger_entries 630" in restored, "600 entries and 30 reversals expected, got $restored")
        assertTrue("rows customers 60" in restored)
        assertTrue("rows flyway_schema_history 9" in restored, "the migration history must survive the restore")
        assertTrue(restored.any { it.startsWith("ledger_balance shops=3 ") }, "three shops carry a balance")
    }

    @Test
    fun `ledger invariants hold on the restored database`() {
        val invariants = connect(restoredUrl, target).use { lines(it, opsSql("drill-invariants.sql")) }
        assertEquals(
            listOf("entries_in_customer_shop 0", "reversal_pairs_consistent 0", "reversals_acknowledged 0"),
            invariants,
        )
    }

    @Test
    fun `the checksum is the server balance rule applied per shop`() {
        connect(restoredUrl, target).use { connection ->
            val byShop = sortedMapOf<String, MutableList<BalanceLine>>()
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT shop_id, type, amount_minor, reverses, reversed_by FROM ledger_entries").use { rows ->
                    while (rows.next()) {
                        byShop.getOrPut(rows.getString("shop_id")) { mutableListOf() } +=
                            BalanceLine(
                                type = rows.getString("type"),
                                amountMinor = rows.getLong("amount_minor"),
                                reverses = rows.getObject("reverses") as UUID?,
                                reversedBy = rows.getObject("reversed_by") as UUID?,
                            )
                    }
                }
            }
            val balances = byShop.mapValues { (_, entries) -> Balance.of(entries) }
            val joined = balances.entries.joinToString(",") { (shop, balance) -> "$shop:$balance" }
            val expected = "ledger_balance shops=${balances.size} total=${balances.values.sum()} sha256=${sha256Hex(joined)}"
            assertEquals(expected, ledgerLine(lines(connection, opsSql("drill-stats.sql"))))
        }
    }

    @Test
    fun `the checksum ignores a reversal pair and changes with one amount`() {
        connect(restoredUrl, target).use { connection ->
            connection.autoCommit = false
            try {
                val before = ledgerLine(lines(connection, opsSql("drill-stats.sql")))
                val original = UUID.randomUUID()
                val reversal = UUID.randomUUID()
                connection.createStatement().use { statement ->
                    statement.execute(
                        """
                        INSERT INTO ledger_entries (id, shop_id, customer_id, client_id, type, amount_minor, occurred_on)
                        SELECT '$original', shop_id, id, gen_random_uuid(), 'DEBT', 12345, DATE '2026-10-02'
                        FROM customers ORDER BY id LIMIT 1
                        """.trimIndent(),
                    )
                    statement.execute(
                        """
                        INSERT INTO ledger_entries (id, shop_id, customer_id, client_id, type, amount_minor, occurred_on, reverses)
                        SELECT '$reversal', shop_id, customer_id, gen_random_uuid(), 'DEBT', 12345, DATE '2026-10-03', id
                        FROM ledger_entries WHERE id = '$original'
                        """.trimIndent(),
                    )
                    statement.execute("UPDATE ledger_entries SET reversed_by = '$reversal' WHERE id = '$original'")
                }
                assertEquals(before, ledgerLine(lines(connection, opsSql("drill-stats.sql"))), "a reversal pair must contribute zero")

                connection.createStatement().use { statement ->
                    statement.execute(
                        """
                        UPDATE ledger_entries SET amount_minor = amount_minor + 1
                        WHERE id = (SELECT id FROM ledger_entries WHERE reverses IS NULL AND reversed_by IS NULL ORDER BY id LIMIT 1)
                        """.trimIndent(),
                    )
                }
                assertNotEquals(
                    before,
                    ledgerLine(lines(connection, opsSql("drill-stats.sql"))),
                    "one changed amount must change the checksum",
                )
            } finally {
                connection.rollback()
            }
        }
    }

    @Test
    fun `the invariant query reports a broken reversal link`() {
        connect(restoredUrl, target).use { connection ->
            connection.autoCommit = false
            try {
                connection.createStatement().use { statement ->
                    statement.execute(
                        "UPDATE ledger_entries SET reversed_by = NULL WHERE id = (SELECT reverses FROM ledger_entries WHERE reverses IS NOT NULL ORDER BY id LIMIT 1)",
                    )
                }
                assertTrue("reversals_acknowledged 1" in lines(connection, opsSql("drill-invariants.sql")))
            } finally {
                connection.rollback()
            }
        }
    }

    private fun connect(
        url: String,
        container: PostgreSQLContainer,
    ): Connection = DriverManager.getConnection(url, container.username, container.password)

    private fun lines(
        connection: Connection,
        sql: String,
    ): List<String> =
        connection.createStatement().use { statement ->
            statement.executeQuery(sql).use { rows ->
                buildList { while (rows.next()) add(rows.getString(1)) }
            }
        }

    private fun ledgerLine(lines: List<String>): String = lines.single { it.startsWith("ledger_balance ") }

    private fun exec(
        container: PostgreSQLContainer,
        vararg command: String,
    ) {
        val result = container.execInContainer(*command)
        assertEquals(0, result.exitCode, "${command.first()} failed: ${result.stderr}")
    }

    private fun opsSql(name: String): String = Files.readString(OPS_DIR.resolve(name))

    private fun sha256Hex(text: String): String =
        MessageDigest
            .getInstance("SHA-256")
            .digest(text.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private companion object {
        // Tests run with the server project as working directory (see TemplateScanTest).
        val OPS_DIR: Path = Path.of("..", "ops", "backup")
        const val DUMP_PATH = "/tmp/cetele-drill.dump"
        const val POSTGRES_PORT = 5432
    }
}
