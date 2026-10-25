using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Patika.Worker.Jobs.Push;

/// <summary>
/// Firebase Cloud Messaging HTTP v1 (<c>projects/{id}/messages:send</c>) with an OAuth2 access token
/// minted from a service account (RS256 JWT bearer grant). Tokens are cached until shortly before expiry.
/// </summary>
public sealed class FcmPushSender : IPushSender
{
    public const string Scope = "https://www.googleapis.com/auth/firebase.messaging";

    private readonly HttpClient http;
    private readonly ServiceAccount account;
    private readonly Uri sendUri;
    private readonly TimeProvider clock;
    private readonly SemaphoreSlim tokenGate = new(1, 1);
    private string? accessToken;
    private DateTimeOffset accessTokenExpiresAt;

    public FcmPushSender(HttpClient http, FcmSettings settings, TimeProvider clock)
    {
        this.http = http;
        this.clock = clock;
        account = JsonSerializer.Deserialize<ServiceAccount>(settings.ServiceAccountJson ?? "")
            ?? throw new InvalidOperationException("Push:Fcm:ServiceAccountJson is not valid.");
        if (string.IsNullOrWhiteSpace(account.ClientEmail) || string.IsNullOrWhiteSpace(account.PrivateKey))
        {
            throw new InvalidOperationException("Push:Fcm:ServiceAccountJson is missing client_email or private_key.");
        }

        sendUri = new Uri($"https://fcm.googleapis.com/v1/projects/{Uri.EscapeDataString(settings.ProjectId!)}/messages:send");
    }

    public async Task<PushOutcome> SendAsync(PushMessage message, CancellationToken cancellationToken)
    {
        var token = await AccessTokenAsync(cancellationToken);
        using var request = new HttpRequestMessage(HttpMethod.Post, sendUri)
        {
            Content = JsonContent.Create(Body(message)),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            return PushOutcome.Sent;
        }

        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            accessToken = null;
        }

        var error = await response.Content.ReadAsStringAsync(cancellationToken);
        return Classify(response.StatusCode, error);
    }

    /// <summary>Maps an FCM error to an outcome; only <c>UNREGISTERED</c>/404 deletes a registration.</summary>
    public static PushOutcome Classify(HttpStatusCode status, string body)
    {
        if (status == HttpStatusCode.NotFound || body.Contains("\"UNREGISTERED\"", StringComparison.Ordinal))
        {
            return PushOutcome.InvalidToken;
        }

        return status is HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable
            or HttpStatusCode.InternalServerError or HttpStatusCode.Unauthorized
            ? PushOutcome.Retryable
            : PushOutcome.Failed;
    }

    public static object Body(PushMessage message) => new
    {
        message = new
        {
            token = message.Token,
            notification = new { title = message.Title, body = message.Body },
            data = message.Data,
            android = new
            {
                priority = message.Critical ? "HIGH" : "NORMAL",
                ttl = message.Critical ? "3600s" : "86400s",
                notification = new { channel_id = message.Critical ? "urgent" : "general" },
            },
        },
    };

    private async Task<string> AccessTokenAsync(CancellationToken cancellationToken)
    {
        if (accessToken is { } cached && clock.GetUtcNow() < accessTokenExpiresAt)
        {
            return cached;
        }

        await tokenGate.WaitAsync(cancellationToken);
        try
        {
            if (accessToken is { } fresh && clock.GetUtcNow() < accessTokenExpiresAt)
            {
                return fresh;
            }

            var now = clock.GetUtcNow();
            var tokenUri = account.TokenUri ?? "https://oauth2.googleapis.com/token";
            var assertion = SignAssertion(account, tokenUri, now);
            using var form = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                ["assertion"] = assertion,
            });
            using var response = await http.PostAsync(tokenUri, form, cancellationToken);
            response.EnsureSuccessStatusCode();
            var grant = await response.Content.ReadFromJsonAsync<TokenGrant>(cancellationToken)
                ?? throw new InvalidOperationException("Empty OAuth response.");
            accessToken = grant.AccessToken;
            accessTokenExpiresAt = now.AddSeconds(Math.Max(60, grant.ExpiresIn - 300));
            return grant.AccessToken;
        }
        finally
        {
            tokenGate.Release();
        }
    }

    public static string SignAssertion(ServiceAccount account, string audience, DateTimeOffset now)
    {
        var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { alg = "RS256", typ = "JWT" }));
        var claims = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new
        {
            iss = account.ClientEmail,
            scope = Scope,
            aud = audience,
            iat = now.ToUnixTimeSeconds(),
            exp = now.AddMinutes(60).ToUnixTimeSeconds(),
        }));
        using var rsa = RSA.Create();
        rsa.ImportFromPem(account.PrivateKey);
        var signingInput = $"{header}.{claims}";
        var signature = rsa.SignData(Encoding.ASCII.GetBytes(signingInput), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return $"{signingInput}.{Base64Url(signature)}";
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public sealed record ServiceAccount(
        [property: JsonPropertyName("client_email")] string ClientEmail,
        [property: JsonPropertyName("private_key")] string PrivateKey,
        [property: JsonPropertyName("token_uri")] string? TokenUri);

    private sealed record TokenGrant(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("expires_in")] int ExpiresIn);
}
