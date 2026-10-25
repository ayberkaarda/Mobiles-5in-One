using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Patika.Contracts.Auth;
using Patika.Contracts.Community;

namespace Patika.App.Core.Api;

public enum AuthMode
{
    /// <summary>Send without a token (sign-in, registration).</summary>
    None,

    /// <summary>Attach a token when there is a session; browse as a guest otherwise.</summary>
    Optional,

    /// <summary>Fail with <see cref="ApiErrorKind.SignInRequired"/> when there is no session.</summary>
    Required,
}

/// <summary>
/// Typed client for <c>/v1</c>. Every POST carries an <c>Idempotency-Key</c> (callers that replay pass
/// their own stable key). A 401 triggers one shared refresh and one retry; a second 401 ends the session.
/// Feature packages call the typed methods or the generic <see cref="SendAsync{T}"/> for endpoints not wrapped here.
/// </summary>
public sealed class PatikaApiClient
{
    public const string IdempotencyHeader = "Idempotency-Key";

    private readonly HttpClient http;
    private readonly TokenManager tokens;

    public PatikaApiClient(HttpClient http, TokenManager tokens, ApiOptions options)
    {
        this.http = http;
        this.tokens = tokens;
        if (http.BaseAddress is null)
        {
            http.BaseAddress = new Uri(options.BaseAddress, "v1/");
            http.Timeout = options.Timeout;
        }
    }

    public TokenManager Tokens => tokens;

    /// <summary>The server clock from the latest response <c>Date</c> header, carried forward on the monotonic clock.</summary>
    public ServerTime ServerTime { get; init; } = new(TimeProvider.System);

    // ---- Auth ---------------------------------------------------------------------------------

    /// <summary>Always 202 for a well-formed request; the next step arrives by email.</summary>
    public Task RegisterAsync(string email, string password, string displayName, CancellationToken ct = default) =>
        SendAsync<RegisterAcceptedResponse>(HttpMethod.Post, "auth/register",
            new RegisterRequest(email, password, displayName), AuthMode.None, ct: ct);

    /// <summary>
    /// Confirms the address with the six-digit code from the email. When the API answers with tokens the
    /// session starts right away.
    /// </summary>
    public async Task<bool> VerifyEmailAsync(string email, string code, CancellationToken ct = default)
    {
        var result = await SendAsync<TokenResponse>(HttpMethod.Post, "auth/verify-email",
            new VerifyEmailRequest(email.Trim(), code.Trim()), AuthMode.None, ct: ct).ConfigureAwait(false);
        if (result is { AccessToken.Length: > 0, RefreshToken.Length: > 0 })
        {
            await tokens.AcceptAsync(result).ConfigureAwait(false);
            return true;
        }

        return false;
    }

    public Task ResendVerificationAsync(string email, CancellationToken ct = default) =>
        SendAsync<RegisterAcceptedResponse>(HttpMethod.Post, "auth/verify-email/resend",
            new ResendVerificationRequest(email.Trim()), AuthMode.None, ct: ct);

    public async Task SignInAsync(string email, string password, CancellationToken ct = default)
    {
        var result = await SendAsync<TokenResponse>(HttpMethod.Post, "auth/login",
            new LoginRequest(email.Trim(), password), AuthMode.None, ct: ct).ConfigureAwait(false);
        await tokens.AcceptAsync(Required(result)).ConfigureAwait(false);
    }

    public async Task SignInWithGoogleAsync(string idToken, CancellationToken ct = default)
    {
        var result = await SendAsync<TokenResponse>(HttpMethod.Post, "auth/google",
            new GoogleSignInRequest(idToken), AuthMode.None, ct: ct).ConfigureAwait(false);
        await tokens.AcceptAsync(Required(result)).ConfigureAwait(false);
    }

    /// <summary>Revokes the refresh token when the server is reachable and always wipes local tokens.</summary>
    public async Task SignOutAsync(CancellationToken ct = default)
    {
        var refresh = await tokens.GetRefreshTokenAsync().ConfigureAwait(false);
        try
        {
            if (refresh is not null)
            {
                await SendAsync<object>(HttpMethod.Post, "auth/logout", new LogoutRequest(refresh), AuthMode.None, ct: ct)
                    .ConfigureAwait(false);
            }
        }
        catch (ApiException)
        {
            // Offline or already revoked: the local wipe below is what matters to this device.
        }
        finally
        {
            await tokens.SignOutAsync().ConfigureAwait(false);
        }
    }

    public async Task<MeResponse> GetMeAsync(CancellationToken ct = default) =>
        Required(await SendAsync<MeResponse>(HttpMethod.Get, "me", null, AuthMode.Required, ct: ct).ConfigureAwait(false));

    // ---- Map and stations ---------------------------------------------------------------------

    public async Task<PageResponse<MapFeature>> GetStationsAsync(MapArea area, MapFilter? filter = null, int page = 1,
        int pageSize = 200, CancellationToken ct = default)
    {
        var query = MapQuery(area, filter, page, pageSize);
        return Required(await SendAsync<PageResponse<MapFeature>>(HttpMethod.Get, "stations" + query, null,
            AuthMode.Optional, ct: ct).ConfigureAwait(false));
    }

    public async Task<StationDetail> GetStationAsync(Guid id, CancellationToken ct = default) =>
        Required(await SendAsync<StationDetail>(HttpMethod.Get, $"stations/{id}", null, AuthMode.Optional, ct: ct)
            .ConfigureAwait(false));

    public async Task<StationResponse> CreateStationAsync(StationRequest request, string? idempotencyKey = null,
        CancellationToken ct = default) =>
        Required(await SendAsync<StationResponse>(HttpMethod.Post, "stations", request, AuthMode.Required,
            idempotencyKey, ct).ConfigureAwait(false));

    /// <param name="session">When set (outbox replay), the request is sent only with a token of that session.</param>
    public async Task<FeedingResponse> CreateFeedingAsync(Guid stationId, FeedingDraft draft, string idempotencyKey,
        DateTimeOffset? clientCreatedAt, SessionBinding? session = null, CancellationToken ct = default) =>
        Required(await SendAsync<FeedingResponse>(HttpMethod.Post, $"stations/{stationId}/feedings",
            new FeedingRequest(draft.PhotoKey, draft.Note, clientCreatedAt), AuthMode.Required, idempotencyKey, ct, session)
            .ConfigureAwait(false));

    public Task MarkNeedsRefillAsync(Guid stationId, string idempotencyKey, SessionBinding? session = null,
        CancellationToken ct = default) =>
        SendAsync<object>(HttpMethod.Post, $"stations/{stationId}/needs-refill", null, AuthMode.Required, idempotencyKey,
            ct, session);

    public async Task<SightingResponse> CreateSightingAsync(Guid animalId, string? note, string idempotencyKey,
        DateTimeOffset? clientCreatedAt, SessionBinding? session = null, CancellationToken ct = default) =>
        Required(await SendAsync<SightingResponse>(HttpMethod.Post, $"animals/{animalId}/sightings",
            new SightingRequest(note, clientCreatedAt), AuthMode.Required, idempotencyKey, ct, session).ConfigureAwait(false));

    // ---- Transport ----------------------------------------------------------------------------

    /// <summary>
    /// Sends one request and reads a JSON body (null for 204 or an empty body). <paramref name="path"/> is
    /// relative to <c>/v1/</c>. POSTs get a fresh Idempotency-Key unless <paramref name="idempotencyKey"/> is given.
    /// With <paramref name="session"/> the request only ever carries a token of that account and session;
    /// if the session changed it fails with <see cref="ErrorCodes.SessionChanged"/> before anything is sent.
    /// </summary>
    public async Task<T?> SendAsync<T>(HttpMethod method, string path, object? body, AuthMode auth,
        string? idempotencyKey = null, CancellationToken ct = default, SessionBinding? session = null)
    {
        if (method == HttpMethod.Post)
        {
            idempotencyKey ??= Guid.NewGuid().ToString();
        }

        using var response = await SendWithSessionAsync(method, path, body, auth, idempotencyKey, session, ct)
            .ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw await ToExceptionAsync(response, ct).ConfigureAwait(false);
        }

        if (response.StatusCode == HttpStatusCode.NoContent || response.Content.Headers.ContentLength == 0
            || typeof(T) == typeof(object))
        {
            return default;
        }

        try
        {
            return await response.Content.ReadFromJsonAsync<T>(ApiJson.Options, ct).ConfigureAwait(false);
        }
        catch (JsonException e)
        {
            throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server, (int)response.StatusCode, inner: e);
        }
    }

    private async Task<HttpResponseMessage> SendWithSessionAsync(HttpMethod method, string path, object? body,
        AuthMode auth, string? idempotencyKey, SessionBinding? session, CancellationToken ct)
    {
        SessionToken current = default;
        if (auth != AuthMode.None)
        {
            current = tokens.Current();
            if (current.Token is null)
            {
                current = await tokens.RefreshAsync(null, ExchangeRefreshAsync, ct).ConfigureAwait(false);
            }

            EnsureBound(session, current);
            if (current.Token is null && auth == AuthMode.Required)
            {
                throw ApiException.SignInRequired();
            }
        }

        var response = await TransmitAsync(Build(method, path, body, current.Token, idempotencyKey), ct).ConfigureAwait(false);
        if (response.StatusCode != HttpStatusCode.Unauthorized || current.Token is null)
        {
            return response;
        }

        response.Dispose();
        var rejectedIn = current.Generation;
        current = await tokens.RefreshAsync(current.Token, ExchangeRefreshAsync, ct).ConfigureAwait(false);
        EnsureBound(session, current);
        if (current.Token is null)
        {
            throw ApiException.SignInRequired();
        }

        response = await TransmitAsync(Build(method, path, body, current.Token, idempotencyKey), ct).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            response.Dispose();
            await tokens.ExpireAsync(onlyIf: rejectedIn).ConfigureAwait(false);
            throw ApiException.SignInRequired();
        }

        return response;
    }

    /// <summary>A bound request may only use a token minted in its own session for its own account.</summary>
    private void EnsureBound(SessionBinding? session, SessionToken token)
    {
        if (session is not null && (token.Generation != session.Generation
            || !string.Equals(tokens.UserId, session.UserId, StringComparison.Ordinal)
            || tokens.Generation != session.Generation))
        {
            throw ApiException.SessionChanged();
        }
    }

    private async Task<TokenResponse> ExchangeRefreshAsync(string refreshToken, CancellationToken ct)
    {
        using var response = await TransmitAsync(
            Build(HttpMethod.Post, "auth/refresh", new RefreshRequest(refreshToken), null, null), ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw await ToExceptionAsync(response, ct).ConfigureAwait(false);
        }

        return Required(await response.Content.ReadFromJsonAsync<TokenResponse>(ApiJson.Options, ct).ConfigureAwait(false));
    }

    private static HttpRequestMessage Build(HttpMethod method, string path, object? body, string? token, string? idempotencyKey)
    {
        var request = new HttpRequestMessage(method, path.TrimStart('/'));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        if (idempotencyKey is not null)
        {
            request.Headers.TryAddWithoutValidation(IdempotencyHeader, idempotencyKey);
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType(), options: ApiJson.Options);
        }

        return request;
    }

    private async Task<HttpResponseMessage> TransmitAsync(HttpRequestMessage request, CancellationToken ct)
    {
        try
        {
            var response = await http.SendAsync(request, ct).ConfigureAwait(false);
            ServerTime.Observe(response.Headers.Date);
            return response;
        }
        catch (OperationCanceledException e) when (!ct.IsCancellationRequested)
        {
            // HttpClient.Timeout surfaces as a cancellation the caller did not ask for.
            throw ApiException.Network(e);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // HttpRequestException, System.IO.IOException, and on Android also Java.IO.IOException and
            // Java.Net.* from the platform handler (seen in airplane mode): all mean "no response".
            throw ApiException.Network(e);
        }
        finally
        {
            request.Dispose();
        }
    }

    /// <summary>Maps a failed response (problem details or not) to an <see cref="ApiException"/> with Turkish text.</summary>
    internal static async Task<ApiException> ToExceptionAsync(HttpResponseMessage response, CancellationToken ct)
    {
        var status = (int)response.StatusCode;
        string? code = null;
        string? title = null;
        Dictionary<string, string[]>? errors = null;
        int? retryAfter = response.Headers.RetryAfter?.Delta is { } delta ? (int)Math.Ceiling(delta.TotalSeconds) : null;
        try
        {
            var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(text) && text.TrimStart().StartsWith('{'))
            {
                using var document = JsonDocument.Parse(text);
                var root = document.RootElement;
                code = ReadString(root, "code");
                title = ReadString(root, "title");
                if (root.TryGetProperty("retryAfterSeconds", out var wait) && wait.ValueKind == JsonValueKind.Number
                    && wait.TryGetInt32(out var seconds) && seconds >= 0)
                {
                    retryAfter = seconds;
                }

                if (root.TryGetProperty("errors", out var errorsElement) && errorsElement.ValueKind == JsonValueKind.Object)
                {
                    errors = [];
                    foreach (var field in errorsElement.EnumerateObject())
                    {
                        errors[field.Name] = field.Value.ValueKind == JsonValueKind.Array
                            ? [.. field.Value.EnumerateArray().Select(x => x.ToString())]
                            : [field.Value.ToString()];
                    }
                }
            }
        }
        catch (JsonException)
        {
            // Not JSON (a proxy page, an empty 502): the status alone decides the message.
        }

        code ??= string.Create(CultureInfo.InvariantCulture, $"http_{status}");
        var kind = status >= 500 ? ApiErrorKind.Server : ApiErrorKind.Client;
        return new ApiException(kind, ErrorMessages.For(code, status), status, code, title, errors)
        {
            RetryAfterSeconds = retryAfter,
        };
    }

    private static string? ReadString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static string MapQuery(MapArea area, MapFilter? filter, int page, int pageSize)
    {
        var parts = new List<string>
        {
            "bbox=" + Uri.EscapeDataString(area.ToBbox()),
            "zoom=" + area.Zoom.ToString(CultureInfo.InvariantCulture),
            "page=" + page.ToString(CultureInfo.InvariantCulture),
            "pageSize=" + pageSize.ToString(CultureInfo.InvariantCulture),
        };
        if (filter?.Kind is { } kind)
        {
            parts.Add("kind=" + Uri.EscapeDataString(kind));
        }

        if (filter?.Species is { } species)
        {
            parts.Add("species=" + Uri.EscapeDataString(species));
        }

        if (filter?.NeedsRefill is { } refill)
        {
            parts.Add("needsRefill=" + (refill ? "true" : "false"));
        }

        return "?" + string.Join('&', parts);
    }

    private static T Required<T>(T? value) where T : class =>
        value ?? throw new ApiException(ApiErrorKind.Server, ErrorMessages.Server);
}
