using Patika.App.Core.Api;
using Patika.Contracts.Community;

namespace Patika.App.Core.Map;

/// <summary>
/// "İstasyonu ekle" with one Idempotency-Key per body. The body and the key are frozen together at the
/// first send. While that send's outcome is unknown (no answer, 5xx, 429, still in progress) every retry
/// resends exactly that body under that key, whatever the form shows now, so the server either replays its
/// answer or creates the station once. Only a known outcome (created, or a final refusal) releases them;
/// the next send then takes the form as it is with a new key.
/// </summary>
public sealed class StationSubmission
{
    private (StationRequest Body, string Key)? frozen;

    /// <summary>The body of a send whose outcome is still unknown, or null.</summary>
    public StationRequest? Unresolved => frozen?.Body;

    public async Task<StationResponse> SubmitAsync(StationRequest current,
        Func<StationRequest, string, CancellationToken, Task<StationResponse>> send, CancellationToken ct = default)
    {
        var (body, key) = frozen ?? (current, Guid.NewGuid().ToString());
        frozen = (body, key);
        try
        {
            var created = await send(body, key, ct).ConfigureAwait(false);
            frozen = null;
            return created;
        }
        catch (ApiException e) when (!e.IsTransient)
        {
            // A final answer (validation, sign-in needed): the server did not create it under this key.
            frozen = null;
            throw;
        }
    }
}
