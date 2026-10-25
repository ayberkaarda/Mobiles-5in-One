using FluentValidation;

namespace Patika.Api.Idempotency;

/// <summary>
/// Optional <c>clientCreatedAt</c> on records made offline (feedings, sightings): when the phone
/// recorded the event, replayed later. Accepted when it is not in the future (up to
/// <see cref="FutureSkew"/> of clock drift) and not older than <see cref="MaxAge"/>.
/// </summary>
public static class ClientTimestamp
{
    public static readonly TimeSpan MaxAge = TimeSpan.FromHours(72);

    /// <summary>Tolerated drift of a phone clock ahead of the server.</summary>
    public static readonly TimeSpan FutureSkew = TimeSpan.FromMinutes(1);

    public const string Message = "clientCreatedAt must not be in the future or older than 72 hours.";

    public static bool IsAcceptable(DateTimeOffset? value, DateTimeOffset now) =>
        value is null || (value.Value <= now + FutureSkew && value.Value >= now - MaxAge);

    /// <summary>The time to store: the client time when given (capped at <paramref name="now"/>), otherwise now.</summary>
    public static DateTimeOffset Resolve(DateTimeOffset? value, DateTimeOffset now) =>
        value is { } client && client < now ? client.ToUniversalTime() : now;

    /// <summary>FluentValidation rule: <c>RuleFor(r => r.ClientCreatedAt).ClientCreatedAt(clock)</c>.</summary>
    public static IRuleBuilderOptions<T, DateTimeOffset?> ClientCreatedAt<T>(
        this IRuleBuilder<T, DateTimeOffset?> rule, TimeProvider clock) =>
        rule.Must(value => IsAcceptable(value, clock.GetUtcNow())).WithMessage(Message);
}
