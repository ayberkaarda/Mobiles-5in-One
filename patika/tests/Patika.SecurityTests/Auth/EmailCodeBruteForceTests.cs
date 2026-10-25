using System.Globalization;
using System.Net;
using Patika.Api.Features.Auth;
using Patika.Api.Tests.Infrastructure;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.SecurityTests.Auth;

/// <summary>An attacker rotating client addresses still gets five guesses per code, and then none.</summary>
public sealed class EmailCodeBruteForceTests
{
    [Fact]
    public async Task RotatingAddressesDoesNotBuyMoreThanFiveGuesses()
    {
        await using var factory = new PatikaApiFactory();
        var email = NewEmail("hedef");
        using (var setup = factory.CreateApiClient("192.0.2.1"))
        {
            using var registered = await setup.PostRegisterAsync(email);
            Assert.Equal(HttpStatusCode.Accepted, registered.StatusCode);
        }

        var code = factory.Outbox.VerificationCodeFor(email);
        var user = factory.Store.Users.Single(u => u.Email == email);
        var statuses = new List<HttpStatusCode>();
        for (var i = 1; i <= 40; i++)
        {
            using var client = factory.CreateApiClient($"192.0.2.{i + 10}");
            var guess = ((int.Parse(code, CultureInfo.InvariantCulture) + i) % 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
            using var response = await client.VerifyEmailAsync(email, guess);
            statuses.Add(response.StatusCode);
        }

        Assert.All(statuses, status => Assert.Equal(HttpStatusCode.BadRequest, status));
        Assert.Equal(5, factory.Store.FailedAttempts(user.Id, EmailTokenRecord.VerifyEmail));
        using var owner = factory.CreateApiClient("192.0.2.200");
        using var right = await owner.VerifyEmailAsync(email, code);
        Assert.Equal(HttpStatusCode.BadRequest, right.StatusCode);
        Assert.Null(factory.Store.Users.Single(u => u.Id == user.Id).EmailVerifiedAt);
    }

    [Fact]
    public async Task EveryPerAddressVerifyAttemptIsCountedEvenWhenTheIpLimitIsNotReached()
    {
        await using var factory = new PatikaApiFactory();
        var email = NewEmail("tek");
        using var client = factory.CreateApiClient("192.0.2.250");
        using (var registered = await client.PostRegisterAsync(email))
        {
            Assert.Equal(HttpStatusCode.Accepted, registered.StatusCode);
        }

        var code = factory.Outbox.VerificationCodeFor(email);
        var user = factory.Store.Users.Single(u => u.Email == email);
        for (var i = 1; i <= 3; i++)
        {
            var guess = ((int.Parse(code, CultureInfo.InvariantCulture) + i) % 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
            using var response = await client.VerifyEmailAsync(email, guess);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        Assert.Equal(3, factory.Store.FailedAttempts(user.Id, EmailTokenRecord.VerifyEmail));
        using var right = await client.VerifyEmailAsync(email, code);
        Assert.Equal(HttpStatusCode.OK, right.StatusCode);
    }
}
