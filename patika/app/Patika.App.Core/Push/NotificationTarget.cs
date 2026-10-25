namespace Patika.App.Core.Push;

/// <summary>
/// Where a tapped notification leads. Only allowlisted <c>type</c> values with a canonical GUID in
/// <c>urgentId</c> lead anywhere (the urgent post); anything else is ignored and the app opens normally.
/// </summary>
public sealed record NotificationTarget(string Kind, Guid Id)
{
    public const string UrgentKind = "urgent";
    public const string TypeKey = "type";
    public const string UrgentIdKey = "urgentId";

    /// <summary>Message types that open an urgent post: the data-only <c>urgent_nearby</c> and the older <c>urgent</c>.</summary>
    public static IReadOnlySet<string> UrgentTypes { get; } = new HashSet<string>(StringComparer.Ordinal) { "urgent_nearby", UrgentKind };

    public static NotificationTarget? From(Func<string, string?> read)
    {
        ArgumentNullException.ThrowIfNull(read);
        if (read(TypeKey) is not { } type || !UrgentTypes.Contains(type))
        {
            return null;
        }

        var raw = read(UrgentIdKey);
        return Guid.TryParseExact(raw, "D", out var id) && id != Guid.Empty && string.Equals(raw, id.ToString("D"), StringComparison.Ordinal)
            ? new NotificationTarget(UrgentKind, id)
            : null;
    }

    public static NotificationTarget? From(IReadOnlyDictionary<string, string> data) =>
        From(key => data.TryGetValue(key, out var value) ? value : null);
}

/// <summary>
/// Holds the target of the last tapped notification until the app can navigate (after a cold start the Shell
/// is not ready when the launch intent arrives). Taking it clears it, so a target is opened once.
/// </summary>
public sealed class NotificationInbox
{
    private readonly Lock gate = new();
    private NotificationTarget? pending;

    /// <summary>Raised after a new target is offered.</summary>
    public event EventHandler? Offered;

    public bool HasPending
    {
        get
        {
            lock (gate)
            {
                return pending is not null;
            }
        }
    }

    public void Offer(NotificationTarget? target)
    {
        if (target is null)
        {
            return;
        }

        lock (gate)
        {
            pending = target;
        }

        Offered?.Invoke(this, EventArgs.Empty);
    }

    public NotificationTarget? Take()
    {
        lock (gate)
        {
            var target = pending;
            pending = null;
            return target;
        }
    }
}

/// <summary>
/// The text a notification shows, chosen by the app from the allowlisted type. Payload titles and bodies are
/// never shown: they would reach the lock screen unchecked, and fixed text carries no personal data.
/// </summary>
public sealed record NotificationContent(string Title, string Body, NotificationTarget Target)
{
    public const string UrgentTitle = "Yakınında acil yardım çağrısı var";
    public const string UrgentBody = "Dokun, çağrıyı ve en yakın bakım yerlerini gör.";

    /// <summary>Null for any type that is not allowlisted or without a valid post id: nothing is shown.</summary>
    public static NotificationContent? From(IReadOnlyDictionary<string, string> data) =>
        NotificationTarget.From(data) is { } target ? new NotificationContent(UrgentTitle, UrgentBody, target) : null;
}
