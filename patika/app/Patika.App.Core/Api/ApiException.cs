using System.Net;

namespace Patika.App.Core.Api;

public enum ApiErrorKind
{
    /// <summary>No response: offline, DNS, TLS, timeout.</summary>
    Network,

    /// <summary>No usable session: never signed in, or the refresh token was rejected.</summary>
    SignInRequired,

    /// <summary>The server answered 4xx.</summary>
    Client,

    /// <summary>The server answered 5xx.</summary>
    Server,
}

/// <summary>
/// Every failure the client surfaces. <see cref="Exception.Message"/> is Turkish text fit for the
/// user, chosen by <see cref="Code"/> (the problem details <c>code</c> member) and falling back to the status.
/// </summary>
public sealed class ApiException : Exception
{
    public ApiException(
        ApiErrorKind kind,
        string message,
        int? status = null,
        string? code = null,
        string? serverTitle = null,
        IReadOnlyDictionary<string, string[]>? fieldErrors = null,
        Exception? inner = null)
        : base(message, inner)
    {
        Kind = kind;
        Status = status;
        Code = code;
        ServerTitle = serverTitle;
        FieldErrors = fieldErrors ?? new Dictionary<string, string[]>();
    }

    public ApiErrorKind Kind { get; }

    public int? Status { get; }

    /// <summary>Machine code from the problem details, or <c>http_{status}</c> when the server sent none.</summary>
    public string? Code { get; }

    /// <summary>The server's own title, kept for logs; not shown to users.</summary>
    public string? ServerTitle { get; }

    /// <summary>Validation messages by field name, from <c>errors</c> on a 400.</summary>
    public IReadOnlyDictionary<string, string[]> FieldErrors { get; }

    /// <summary>
    /// How long the server asks to wait: the problem details <c>retryAfterSeconds</c> member (for example
    /// with <c>feeding_cooldown</c>) or else the <c>Retry-After</c> header; null when it sent neither.
    /// </summary>
    public int? RetryAfterSeconds { get; init; }

    /// <summary>
    /// Worth retrying later with the same request: no response, 5xx, 408, 429 or a duplicate still in flight.
    /// Everything else is a final answer about this request.
    /// </summary>
    public bool IsTransient => Kind is ApiErrorKind.Network or ApiErrorKind.Server
        || Status is (int)HttpStatusCode.RequestTimeout or (int)HttpStatusCode.TooManyRequests
        || Code is ErrorCodes.IdempotencyInProgress;

    public static ApiException Network(Exception inner) =>
        new(ApiErrorKind.Network, ErrorMessages.Network, inner: inner);

    public static ApiException SignInRequired() =>
        new(ApiErrorKind.SignInRequired, ErrorMessages.SignInRequired, status: 401, code: ErrorCodes.SignInRequired);

    /// <summary>The account or session changed while a background request was prepared; nothing was sent.</summary>
    public static ApiException SessionChanged() =>
        new(ApiErrorKind.SignInRequired, ErrorMessages.SignInRequired, code: ErrorCodes.SessionChanged);
}
