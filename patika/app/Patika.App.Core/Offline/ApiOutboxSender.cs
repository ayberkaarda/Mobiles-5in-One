using System.Text.Json;
using Patika.App.Core.Api;

namespace Patika.App.Core.Offline;

/// <summary>
/// Maps each outbox kind to its endpoint, with the item's own Idempotency-Key and client time, bound to
/// the session the replay pass runs for. A record that cannot be read (bad id, bad payload, unknown kind)
/// fails with <see cref="ErrorCodes.OutboxMalformed"/> so the replayer sets it aside instead of blocking the queue.
/// </summary>
public sealed class ApiOutboxSender(PatikaApiClient api) : IOutboxSender
{
    public async Task SendAsync(OutboxItem item, SessionBinding session, CancellationToken ct)
    {
        if (!Guid.TryParse(item.TargetId, out var target))
        {
            throw Malformed();
        }

        switch (item.Kind)
        {
            case OutboxKinds.Feeding:
                var feeding = Read<FeedingDraft>(item.Payload);
                await api.CreateFeedingAsync(target, feeding, item.IdempotencyKey, item.ClientCreatedAt, session, ct)
                    .ConfigureAwait(false);
                break;
            case OutboxKinds.NeedsRefill:
                await api.MarkNeedsRefillAsync(target, item.IdempotencyKey, session, ct).ConfigureAwait(false);
                break;
            case OutboxKinds.Sighting:
                var sighting = Read<SightingDraft>(item.Payload);
                await api.CreateSightingAsync(target, sighting.Note, item.IdempotencyKey, item.ClientCreatedAt, session, ct)
                    .ConfigureAwait(false);
                break;
            default:
                throw Malformed();
        }
    }

    private static T Read<T>(string payload) where T : class
    {
        try
        {
            return JsonSerializer.Deserialize<T>(payload, ApiJson.Options) ?? throw Malformed();
        }
        catch (JsonException e)
        {
            throw Malformed(e);
        }
    }

    private static ApiException Malformed(Exception? inner = null) =>
        new(ApiErrorKind.Client, ErrorMessages.For(ErrorCodes.OutboxMalformed, null), code: ErrorCodes.OutboxMalformed, inner: inner);
}

public sealed record SightingDraft(string? Note = null);
