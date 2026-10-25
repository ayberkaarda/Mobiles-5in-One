using System.Text.Json;
using Patika.App.Core.Api;

namespace Patika.App.Core.Offline;

public enum SubmitOutcome
{
    /// <summary>The server accepted it.</summary>
    Sent,

    /// <summary>Saved on the phone; it goes out when the connection is back.</summary>
    Queued,

    /// <summary>The server refused it for good; see <see cref="SubmitResult.ErrorCode"/>.</summary>
    Rejected,
}

public sealed record SubmitResult(SubmitOutcome Outcome, OutboxItem Item, string? ErrorCode = null, string? Message = null);

/// <summary>
/// The quick field records (Beslendi, Mama bitti, Bugün gördüm). Each one always goes through the outbox,
/// online or not, so there is a single path with a stable Idempotency-Key and client time; when online the
/// outbox is replayed at once and the caller learns whether it went out.
/// </summary>
public sealed class FieldActions(Outbox outbox, OutboxReplayer replayer, TokenManager tokens, INetworkStatus network)
{
    public Task<SubmitResult> FeedAsync(Guid stationId, FeedingDraft draft, CancellationToken ct = default) =>
        SubmitAsync(OutboxKinds.Feeding, stationId, JsonSerializer.Serialize(draft, ApiJson.Options), ct);

    public Task<SubmitResult> ReportEmptyAsync(Guid stationId, CancellationToken ct = default) =>
        SubmitAsync(OutboxKinds.NeedsRefill, stationId, "{}", ct);

    public Task<SubmitResult> SightAsync(Guid animalId, string? note, CancellationToken ct = default) =>
        SubmitAsync(OutboxKinds.Sighting, animalId, JsonSerializer.Serialize(new SightingDraft(note), ApiJson.Options), ct);

    private async Task<SubmitResult> SubmitAsync(string kind, Guid target, string payload, CancellationToken ct)
    {
        var owner = tokens.UserId ?? throw ApiException.SignInRequired();
        var item = await outbox.EnqueueAsync(owner, kind, target.ToString(), payload, ct).ConfigureAwait(false);
        if (!network.IsOnline)
        {
            return new SubmitResult(SubmitOutcome.Queued, item);
        }

        await replayer.ReplayAsync(ct).ConfigureAwait(false);
        var after = await outbox.GetAsync(item.Seq, ct).ConfigureAwait(false);
        if (after is null)
        {
            return new SubmitResult(SubmitOutcome.Sent, item);
        }

        if (after.State == OutboxState.Rejected)
        {
            // Answered right away, so the screen shows it; no need to keep it in the outbox list.
            await outbox.DeleteAsync(after.Seq, ct).ConfigureAwait(false);
            return new SubmitResult(SubmitOutcome.Rejected, after, after.ErrorCode, after.ErrorMessage);
        }

        return new SubmitResult(SubmitOutcome.Queued, after, after.ErrorCode, after.ErrorMessage);
    }
}
