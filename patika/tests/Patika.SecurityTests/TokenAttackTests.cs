using System.Net;
using System.Net.Http.Json;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Patika.Domain.Security;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.SecurityTests;

public sealed class TokenAttackTests : IAsyncLifetime
{
    private readonly PatikaApiFactory factory = new();
    private HttpClient client = null!;
    private TokenResponse tokens = null!;
    private Guid userId;

    public async ValueTask InitializeAsync()
    {
        client = factory.CreateApiClient();
        var email = NewEmail();
        tokens = await client.RegisterAsync(factory, email);
        userId = factory.Store.Users.Single(u => u.Email == email).Id;
    }

    public async ValueTask DisposeAsync()
    {
        client.Dispose();
        await factory.DisposeAsync();
    }

    [Fact]
    public async Task GenuineAndServerSignedTokensAreAccepted()
    {
        using var genuine = await client.GetMeAsync(tokens.AccessToken);
        using var resigned = await client.GetMeAsync(JwtForge.Sign(userId, ActorRole.User, JwtForge.ServerKey()));

        Assert.Equal(HttpStatusCode.OK, genuine.StatusCode);
        Assert.Equal(HttpStatusCode.OK, resigned.StatusCode);
    }

    public static TheoryData<string> Tampered() =>
    [
        "alg-none", "attacker-key", "swapped-payload", "expired", "wrong-issuer",
        "wrong-audience", "plain-jwt-type", "truncated-signature",
    ];

    [Theory]
    [MemberData(nameof(Tampered))]
    public async Task TamperedAccessTokensAreRejected(string attack)
    {
        var token = attack switch
        {
            "alg-none" => JwtForge.Unsigned(userId, ActorRole.Admin),
            "attacker-key" => JwtForge.Sign(userId, ActorRole.User, JwtForge.AttackerKey()),
            "swapped-payload" => JwtForge.SwapPayload(tokens.AccessToken, userId, ActorRole.Admin),
            "expired" => JwtForge.Sign(userId, ActorRole.User, JwtForge.ServerKey(), expires: DateTime.UtcNow.AddMinutes(-5)),
            "wrong-issuer" => JwtForge.Sign(userId, ActorRole.User, JwtForge.ServerKey(), issuer: "https://evil.example"),
            "wrong-audience" => JwtForge.Sign(userId, ActorRole.User, JwtForge.ServerKey(), audience: "another-api"),
            "plain-jwt-type" => JwtForge.Sign(userId, ActorRole.User, JwtForge.ServerKey(), tokenType: "JWT"),
            "truncated-signature" => tokens.AccessToken[..^4],
            _ => throw new InvalidOperationException(attack),
        };

        using var response = await client.GetMeAsync(token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    public static TheoryData<string> PublicKeyRepresentations() => [.. JwtForge.PublicKeyRepresentations];

    [Theory]
    [MemberData(nameof(PublicKeyRepresentations))]
    public async Task AlgorithmConfusionWithThePublicKeyAsHmacSecretIsRejected(string representation)
    {
        var token = JwtForge.SignWithPublicKeyAsHmac(userId, ActorRole.User, representation);

        // The fixture is a working attack: a validator that trusts the header's algorithm accepts it.
        Assert.True(await JwtForge.VulnerableValidatorAcceptsAsync(token, representation));

        using var response = await client.GetMeAsync(token);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task RefreshReuseRevokesTheWholeFamily()
    {
        using var first = await client.RefreshAsync(tokens.RefreshToken);
        var rotated = (await first.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
        using var second = await client.RefreshAsync(rotated.RefreshToken);
        var current = (await second.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        // An attacker replays the stolen original token.
        using var replay = await client.RefreshAsync(tokens.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
        Assert.Equal(AuthErrorCodes.RefreshReused, (await replay.ReadProblemAsync()).Code);

        // The legitimate holder's newest token is now dead too, and so is every token in the family.
        using var afterReuse = await client.RefreshAsync(current.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, afterReuse.StatusCode);
        var family = factory.Store.Tokens.Single(t => t.TokenHash.SequenceEqual(
            Patika.Api.Security.Tokens.RefreshTokens.Hash(current.RefreshToken))).FamilyId;
        Assert.All(factory.Store.Tokens.Where(t => t.FamilyId == family), t => Assert.NotNull(t.RevokedAt));
    }

    [Fact]
    public async Task ReuseInOneFamilyDoesNotEndOtherSessions()
    {
        using var otherLogin = await client.LoginAsync(factory.Store.Users.Single().Email!);
        var otherDevice = (await otherLogin.Content.ReadFromJsonAsync<TokenResponse>(Ct))!;

        using var rotate = await client.RefreshAsync(tokens.RefreshToken);
        using var replay = await client.RefreshAsync(tokens.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);

        using var other = await client.RefreshAsync(otherDevice.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, other.StatusCode);
    }

    [Fact]
    public async Task ConcurrentRefreshOfTheSameTokenYieldsAtMostOneWinner()
    {
        var attempts = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => client.RefreshAsync(tokens.RefreshToken)));
        try
        {
            var statuses = attempts.Select(r => r.StatusCode).ToArray();
            Assert.True(statuses.Count(s => s == HttpStatusCode.OK) <= 1, string.Join(",", statuses));
            Assert.Contains(HttpStatusCode.Unauthorized, statuses);

            // Reuse was detected, so no token of the family is usable afterwards.
            Assert.All(factory.Store.Tokens, t => Assert.NotNull(t.RevokedAt));
        }
        finally
        {
            foreach (var attempt in attempts)
            {
                attempt.Dispose();
            }
        }
    }
}
