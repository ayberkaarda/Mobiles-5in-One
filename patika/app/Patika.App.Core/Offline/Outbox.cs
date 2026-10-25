using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Patika.App.Core.Offline;

/// <summary>What a queued record does when replayed.</summary>
public static class OutboxKinds
{
    /// <summary>POST /v1/stations/{target}/feedings ("Beslendi").</summary>
    public const string Feeding = "feeding";

    /// <summary>POST /v1/stations/{target}/needs-refill ("Mama bitti").</summary>
    public const string NeedsRefill = "needs_refill";

    /// <summary>POST /v1/animals/{target}/sightings ("Bugün gördüm").</summary>
    public const string Sighting = "sighting";
}

public enum OutboxState
{
    /// <summary>Waiting to be sent (first try or retry after backoff).</summary>
    Pending,

    /// <summary>The server refused it for good (for example the 30-minute cooldown); kept so the user sees it.</summary>
    Rejected,

    /// <summary>Gave up after too many attempts or too long a wait, or the record could not be read; kept so the user sees it.</summary>
    Failed,
}

/// <summary>What the map shows: records still to send, and records that will not be sent with the latest reason.</summary>
public sealed record OutboxCounts(int Pending, int Stuck, string? LastReason);

public sealed record OutboxItem(
    long Seq,
    string Owner,
    string Kind,
    string TargetId,
    string Payload,
    string IdempotencyKey,
    DateTimeOffset ClientCreatedAt,
    OutboxState State,
    int Attempts,
    DateTimeOffset NextAttemptAt,
    string? ErrorCode,
    string? ErrorMessage);

/// <summary>
/// Durable queue of records made on the phone. Order is the insertion order (<c>seq</c>) per owner.
/// The Idempotency-Key is fixed at enqueue time, so every retry of an item is the same request to the server.
/// </summary>
public sealed class Outbox(OfflineDatabase database, TimeProvider clock)
{
    /// <summary>Raised after any change, for counters and lists.</summary>
    public event EventHandler? Changed;

    public async Task<OutboxItem> EnqueueAsync(string owner, string kind, string targetId, string payload,
        CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var key = Guid.NewGuid().ToString();
        long seq;
        await using (var connection = await database.OpenAsync(ct).ConfigureAwait(false))
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                INSERT INTO outbox (owner, kind, target_id, payload, idempotency_key, client_created_at, state, attempts, next_attempt_at)
                VALUES ($owner, $kind, $target, $payload, $key, $created, 'Pending', 0, 0);
                SELECT last_insert_rowid();
                """;
            command.Parameters.AddWithValue("$owner", owner);
            command.Parameters.AddWithValue("$kind", kind);
            command.Parameters.AddWithValue("$target", targetId);
            command.Parameters.AddWithValue("$payload", payload);
            command.Parameters.AddWithValue("$key", key);
            command.Parameters.AddWithValue("$created", now.ToUnixTimeMilliseconds());
            seq = Convert.ToInt64(await command.ExecuteScalarAsync(ct).ConfigureAwait(false), CultureInfo.InvariantCulture);
        }

        Changed?.Invoke(this, EventArgs.Empty);
        return new OutboxItem(seq, owner, kind, targetId, payload, key, now, OutboxState.Pending, 0,
            DateTimeOffset.FromUnixTimeMilliseconds(0), null, null);
    }

    /// <summary>All items of <paramref name="owner"/>, oldest first.</summary>
    public async Task<IReadOnlyList<OutboxItem>> ListAsync(string owner, CancellationToken ct = default)
    {
        await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = Select + " WHERE owner = $owner ORDER BY seq;";
        command.Parameters.AddWithValue("$owner", owner);
        return await ReadAllAsync(command, ct).ConfigureAwait(false);
    }

    public async Task<OutboxItem?> GetAsync(long seq, CancellationToken ct = default)
    {
        await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = Select + " WHERE seq = $seq;";
        command.Parameters.AddWithValue("$seq", seq);
        var rows = await ReadAllAsync(command, ct).ConfigureAwait(false);
        return rows.Count == 0 ? null : rows[0];
    }

    /// <summary>The oldest pending item of <paramref name="owner"/>, whether or not its backoff has passed.</summary>
    public async Task<OutboxItem?> PeekAsync(string owner, CancellationToken ct = default)
    {
        await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = Select + " WHERE owner = $owner AND state = 'Pending' ORDER BY seq LIMIT 1;";
        command.Parameters.AddWithValue("$owner", owner);
        var rows = await ReadAllAsync(command, ct).ConfigureAwait(false);
        return rows.Count == 0 ? null : rows[0];
    }

    public async Task<int> CountPendingAsync(string owner, CancellationToken ct = default)
    {
        await using var connection = await database.OpenAsync(ct).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*) FROM outbox WHERE owner = $owner AND state = 'Pending';";
        command.Parameters.AddWithValue("$owner", owner);
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct).ConfigureAwait(false), CultureInfo.InvariantCulture);
    }

    /// <summary>Sent and accepted: the record now lives on the server.</summary>
    public Task CompleteAsync(long seq, CancellationToken ct = default) =>
        ExecuteAsync("DELETE FROM outbox WHERE seq = $seq;", ct, ("$seq", seq));

    /// <summary>Failed for now: count the attempt and wait until <paramref name="nextAttemptAt"/>.</summary>
    public Task DeferAsync(long seq, DateTimeOffset nextAttemptAt, string? code, string message, CancellationToken ct = default) =>
        ExecuteAsync("""
            UPDATE outbox SET attempts = attempts + 1, next_attempt_at = $next, error_code = $code, error_message = $message
            WHERE seq = $seq;
            """, ct, ("$seq", seq), ("$next", nextAttemptAt.ToUnixTimeMilliseconds()), ("$code", code), ("$message", message));

    /// <summary>Refused for good: keep it visible as rejected and move on to the next item.</summary>
    public Task RejectAsync(long seq, string? code, string message, CancellationToken ct = default) =>
        ExecuteAsync("""
            UPDATE outbox SET state = 'Rejected', attempts = attempts + 1, error_code = $code, error_message = $message
            WHERE seq = $seq;
            """, ct, ("$seq", seq), ("$code", code), ("$message", message));

    /// <summary>Stopped for good on our side (attempts or age ran out); kept visible as failed.</summary>
    public Task FailAsync(long seq, string? code, string message, CancellationToken ct = default) =>
        ExecuteAsync("""
            UPDATE outbox SET state = 'Failed', attempts = attempts + 1, error_code = $code, error_message = $message
            WHERE seq = $seq;
            """, ct, ("$seq", seq), ("$code", code), ("$message", message));

    /// <summary>Pending, and rejected or failed, counts of the owner with the newest reason for the latter.</summary>
    public async Task<OutboxCounts> CountAsync(string owner, CancellationToken ct = default)
    {
        var items = await ListAsync(owner, ct).ConfigureAwait(false);
        var stuck = items.Where(i => i.State != OutboxState.Pending).ToArray();
        return new OutboxCounts(items.Count - stuck.Length, stuck.Length, stuck.LastOrDefault()?.ErrorMessage);
    }

    /// <summary>Removes the rejected and failed items of the owner once the user has seen them.</summary>
    public Task DismissStuckAsync(string owner, CancellationToken ct = default) =>
        ExecuteAsync("DELETE FROM outbox WHERE owner = $owner AND state <> 'Pending';", ct, ("$owner", owner));

    /// <summary>"Şimdi yeniden dene": lift the backoff of every pending item of the owner.</summary>
    public Task RetryNowAsync(string owner, CancellationToken ct = default) =>
        ExecuteAsync("UPDATE outbox SET next_attempt_at = 0 WHERE owner = $owner AND state = 'Pending';", ct, ("$owner", owner));

    public Task DeleteAsync(long seq, CancellationToken ct = default) =>
        ExecuteAsync("DELETE FROM outbox WHERE seq = $seq;", ct, ("$seq", seq));

    /// <summary>Drops what other accounts left on this phone, so it is never sent under the wrong name.</summary>
    public Task DeleteOtherOwnersAsync(string owner, CancellationToken ct = default) =>
        ExecuteAsync("DELETE FROM outbox WHERE owner <> $owner;", ct, ("$owner", owner));

    public Task ClearAsync(CancellationToken ct = default) => ExecuteAsync("DELETE FROM outbox;", ct);

    private const string Select = """
        SELECT seq, owner, kind, target_id, payload, idempotency_key, client_created_at, state, attempts,
            next_attempt_at, error_code, error_message FROM outbox
        """;

    private async Task ExecuteAsync(string sql, CancellationToken ct, params (string Name, object? Value)[] parameters)
    {
        await using (var connection = await database.OpenAsync(ct).ConfigureAwait(false))
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = sql;
            foreach (var (name, value) in parameters)
            {
                command.Parameters.AddWithValue(name, value ?? DBNull.Value);
            }

            await command.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    private static async Task<IReadOnlyList<OutboxItem>> ReadAllAsync(SqliteCommand command, CancellationToken ct)
    {
        var items = new List<OutboxItem>();
        await using var reader = await command.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            items.Add(new OutboxItem(
                reader.GetInt64(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                DateTimeOffset.FromUnixTimeMilliseconds(reader.GetInt64(6)),
                Enum.Parse<OutboxState>(reader.GetString(7)),
                reader.GetInt32(8),
                DateTimeOffset.FromUnixTimeMilliseconds(reader.GetInt64(9)),
                reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetString(11)));
        }

        return items;
    }
}
