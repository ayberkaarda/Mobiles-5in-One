using Microsoft.Data.Sqlite;

namespace Patika.App.Core.Offline;

/// <summary>
/// One SQLite file in the app's private data folder holding the map cache and the outbox.
/// Nothing in it is a secret (tokens are in SecureStorage) and no location of the user is stored;
/// station coordinates are public data. Android backup is off for the app.
/// </summary>
public sealed class OfflineDatabase
{
    private readonly string connectionString;
    private readonly SemaphoreSlim ready = new(1, 1);
    private bool created;

    public OfflineDatabase(string path)
    {
        connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
        }.ToString();
    }

    public async Task<SqliteConnection> OpenAsync(CancellationToken ct = default)
    {
        var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync(ct).ConfigureAwait(false);
        if (!created)
        {
            await EnsureSchemaAsync(connection, ct).ConfigureAwait(false);
        }

        return connection;
    }

    private async Task EnsureSchemaAsync(SqliteConnection connection, CancellationToken ct)
    {
        await ready.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (created)
            {
                return;
            }

            await using var command = connection.CreateCommand();
            command.CommandText = """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS map_region (
                    slot INTEGER PRIMARY KEY CHECK (slot = 1),
                    area TEXT NOT NULL,
                    filter TEXT,
                    features TEXT NOT NULL,
                    saved_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS station_cache (
                    id TEXT PRIMARY KEY,
                    body TEXT NOT NULL,
                    saved_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_station_cache_saved_at ON station_cache (saved_at);
                CREATE TABLE IF NOT EXISTS outbox (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    owner TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    client_created_at INTEGER NOT NULL,
                    state TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at INTEGER NOT NULL DEFAULT 0,
                    error_code TEXT,
                    error_message TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_outbox_owner_state ON outbox (owner, state, seq);
                PRAGMA user_version = 1;
                """;
            await command.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            created = true;
        }
        finally
        {
            ready.Release();
        }
    }
}
