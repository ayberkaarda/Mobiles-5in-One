using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Patika.Api.Email;
using Patika.Api.Features.Auth;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Auth;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.Api.Tests.Auth;

/// <summary>Six-digit email codes over HTTP: attempt limit, expiry, resend and enumeration safety.</summary>
public sealed class EmailCodeTests : IAsyncLifetime
{
    private const string NewPassword = "yeni-mama-kabi-55";

    private readonly PatikaApiFactory factory = new();
    private LifecycleAuthStore store = null!;
    private int peer;

    public ValueTask InitializeAsync()
    {
        store = new LifecycleAuthStore(factory.Store);
        factory.ExtraServices = services => PasswordResetTests.ReplaceStores(services, store);
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync() => await factory.DisposeAsync();

    [Fact]
    public async Task VerificationEmailCarriesASixDigitCodeValidFifteenMinutes()
    {
        var email = NewEmail();
        using var registered = await Client().PostRegisterAsync(email);

        var message = factory.Outbox.For(email).Single(m => m.Kind == EmailKind.VerifyEmail);
        var code = factory.Outbox.VerificationCodeFor(email);
        Assert.Matches("^[0-9]{6}$", code);
        Assert.Contains("15 dakika", message.Body, StringComparison.Ordinal);
        Assert.Equal(TimeSpan.FromMinutes(15), EmailCodeHasher.Lifetime);
        Assert.Equal(TimeSpan.FromMinutes(15), AuthHandlers.EmailTokenLifetime);
    }

    [Fact]
    public async Task FiveWrongCodesBurnTheCodeSoTheRightOneNoLongerWorks()
    {
        var email = NewEmail();
        using var registered = await Client().PostRegisterAsync(email);
        var code = factory.Outbox.VerificationCodeFor(email);
        var user = factory.Store.Users.Single(u => u.Email == email);

        var wrong = code;
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            wrong = TestEmailCodes.Other(wrong);
            using var guess = await Client().VerifyEmailAsync(email, wrong);
            Assert.Equal(HttpStatusCode.BadRequest, guess.StatusCode);
            Assert.Equal(AuthErrorCodes.VerificationInvalid, (await guess.ReadProblemAsync()).Code);
            Assert.Equal(attempt, factory.Store.FailedAttempts(user.Id, EmailTokenRecord.VerifyEmail));
        }

        using var right = await Client().VerifyEmailAsync(email, code);
        Assert.Equal(HttpStatusCode.BadRequest, right.StatusCode);
        Assert.Equal(AuthErrorCodes.VerificationInvalid, (await right.ReadProblemAsync()).Code);
        Assert.Equal(5, factory.Store.FailedAttempts(user.Id, EmailTokenRecord.VerifyEmail));
        Assert.Null(factory.Store.Users.Single(u => u.Id == user.Id).EmailVerifiedAt);

        // A fresh code is the only way back in.
        using var resend = await Client().ResendVerificationAsync(email);
        Assert.Equal(HttpStatusCode.Accepted, resend.StatusCode);
        using var fresh = await Client().VerifyEmailAsync(email, factory.Outbox.VerificationCodeFor(email));
        Assert.Equal(HttpStatusCode.OK, fresh.StatusCode);
    }

    [Fact]
    public async Task FourWrongCodesStillLeaveTheRightOneUsable()
    {
        var email = NewEmail();
        using var registered = await Client().PostRegisterAsync(email);
        var code = factory.Outbox.VerificationCodeFor(email);

        var wrong = code;
        for (var attempt = 1; attempt <= 4; attempt++)
        {
            wrong = TestEmailCodes.Other(wrong);
            using var guess = await Client().VerifyEmailAsync(email, wrong);
            Assert.Equal(HttpStatusCode.BadRequest, guess.StatusCode);
        }

        using var right = await Client().VerifyEmailAsync(email, code);
        Assert.Equal(HttpStatusCode.OK, right.StatusCode);
    }

    [Fact]
    public async Task ExpiredCodeIsRejected()
    {
        var email = NewEmail();
        using var registered = await Client().PostRegisterAsync(email);
        var code = factory.Outbox.VerificationCodeFor(email);
        factory.Store.ExpireEmailTokens(EmailTokenRecord.VerifyEmail);

        using var late = await Client().VerifyEmailAsync(email, code);

        Assert.Equal(HttpStatusCode.BadRequest, late.StatusCode);
        Assert.Equal(AuthErrorCodes.VerificationInvalid, (await late.ReadProblemAsync()).Code);
    }

    [Fact]
    public async Task ResendInvalidatesThePreviousCode()
    {
        var email = NewEmail();
        using var registered = await Client().PostRegisterAsync(email);
        var first = factory.Outbox.VerificationCodeFor(email);

        using var resend = await Client().ResendVerificationAsync(email);
        Assert.Equal(HttpStatusCode.Accepted, resend.StatusCode);
        var second = factory.Outbox.VerificationCodeFor(email);
        Assert.Equal(2, factory.Outbox.For(email).Count(m => m.Kind == EmailKind.VerifyEmail));

        if (first != second)
        {
            using var old = await Client().VerifyEmailAsync(email, first);
            Assert.Equal(HttpStatusCode.BadRequest, old.StatusCode);
        }

        using var fresh = await Client().VerifyEmailAsync(email, second);
        Assert.Equal(HttpStatusCode.OK, fresh.StatusCode);
        Assert.Equal(0, store.Inner.LiveCodeCount(EmailTokenRecord.VerifyEmail));
        Assert.Equal(2, store.Inner.CodeCount(EmailTokenRecord.VerifyEmail));
    }

    [Fact]
    public async Task ResendAnswersEveryAddressIdenticallyAndOnlyMailsPendingAccounts()
    {
        var pending = NewEmail("bekleyen");
        using (var registered = await Client().PostRegisterAsync(pending))
        {
            Assert.Equal(HttpStatusCode.Accepted, registered.StatusCode);
        }

        var verified = NewEmail("dogrulanmis");
        await Client().RegisterAsync(factory, verified);
        var unknown = NewEmail("bilinmeyen");
        var before = factory.Outbox.Messages.Count;

        var responses = new List<(HttpStatusCode Status, string Body, string[] Headers)>();
        foreach (var email in new[] { pending, verified, unknown })
        {
            using var response = await Client().ResendVerificationAsync(email);
            responses.Add((response.StatusCode, await response.Content.ReadAsStringAsync(Ct), HeaderNames(response)));
        }

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.Accepted, r.Status));
        Assert.All(responses, r => Assert.Equal("{\"status\":\"verification_pending\"}", r.Body));
        Assert.All(responses, r => Assert.Equal(responses[0].Headers, r.Headers));
        var sent = factory.Outbox.Messages.Skip(before).ToArray();
        var mail = Assert.Single(sent);
        Assert.Equal(pending, mail.To);
        Assert.Equal(EmailKind.VerifyEmail, mail.Kind);
    }

    [Fact]
    public async Task WrongCodeAndUnknownAddressGetTheSameRejection()
    {
        var known = NewEmail("bilinen");
        using var registered = await Client().PostRegisterAsync(known);
        var code = factory.Outbox.VerificationCodeFor(known);
        var wrong = TestEmailCodes.Other(code);

        using var knownWrong = await Client().VerifyEmailAsync(known, wrong);
        using var unknown = await Client().VerifyEmailAsync(NewEmail("bilinmeyen"), wrong);

        Assert.Equal(knownWrong.StatusCode, unknown.StatusCode);
        Assert.Equal(await WithoutTraceIdAsync(knownWrong), await WithoutTraceIdAsync(unknown));
        Assert.Equal(HeaderNames(knownWrong), HeaderNames(unknown));

        using var knownReset = await ResetAsync(known, wrong);
        using var unknownReset = await ResetAsync(NewEmail("bilinmeyen"), wrong);
        Assert.Equal(knownReset.StatusCode, unknownReset.StatusCode);
        Assert.Equal(await WithoutTraceIdAsync(knownReset), await WithoutTraceIdAsync(unknownReset));
    }

    [Fact]
    public async Task ResendIsLimitedPerAddress()
    {
        var email = NewEmail("sinir");
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 4; i++)
        {
            using var response = await Client().ResendVerificationAsync(email);
            statuses.Add(response.StatusCode);
        }

        Assert.Equal([HttpStatusCode.Accepted, HttpStatusCode.Accepted, HttpStatusCode.Accepted, HttpStatusCode.TooManyRequests],
            statuses);
    }

    [Fact]
    public async Task ResendIsLimitedPerIp()
    {
        var statuses = new List<HttpStatusCode>();
        using var client = factory.CreateApiClient("198.51.100.250");
        for (var i = 0; i < 6; i++)
        {
            using var response = await client.ResendVerificationAsync(NewEmail("ip"));
            statuses.Add(response.StatusCode);
        }

        Assert.Equal(Enumerable.Repeat(HttpStatusCode.Accepted, 5), statuses.Take(5));
        Assert.Equal(HttpStatusCode.TooManyRequests, statuses[5]);
    }

    [Fact]
    public async Task ResetCodeIsBurnedAfterFiveWrongGuesses()
    {
        var email = NewEmail();
        await Client().RegisterAsync(factory, email);
        using (var forgot = await Client().PostAsJsonAsync("/v1/auth/forgot", new ForgotPasswordRequest(email), Ct))
        {
            Assert.Equal(HttpStatusCode.Accepted, forgot.StatusCode);
        }

        var code = PasswordResetTests.CodeFrom(factory.Outbox.For(email).Last(m => m.Kind == EmailKind.PasswordReset));
        Assert.Matches("^[0-9]{6}$", code);
        var wrong = code;
        for (var attempt = 0; attempt < 5; attempt++)
        {
            wrong = TestEmailCodes.Other(wrong);
            using var guess = await ResetAsync(email, wrong);
            Assert.Equal(HttpStatusCode.BadRequest, guess.StatusCode);
            Assert.Equal(PasswordResetErrorCodes.ResetInvalid, (await guess.ReadProblemAsync()).Code);
        }

        using var right = await ResetAsync(email, code);
        Assert.Equal(HttpStatusCode.BadRequest, right.StatusCode);
        using var oldLogin = await Client().LoginAsync(email);
        Assert.Equal(HttpStatusCode.OK, oldLogin.StatusCode);
    }

    [Fact]
    public async Task MalformedCodesAreValidationErrors()
    {
        foreach (var code in new[] { "12345", "1234567", "12a456", "١٢٣٤٥٦", " 123456" })
        {
            using var response = await Client().VerifyEmailAsync(NewEmail(), code);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(AuthErrorCodes.ValidationFailed, (await response.ReadProblemAsync()).Code);
        }

        using var oldShape = await Client().PostAsJsonAsync("/v1/auth/verify-email", new { token = new string('a', 43) }, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, oldShape.StatusCode);
    }

    [Fact]
    public void CodesAreKeyedAndBoundToTheirRow()
    {
        var hasher = TestEmailCodes.Hasher;
        var other = new EmailCodeHasher(RandomNumberGenerator.GetBytes(32));
        var id = Guid.CreateVersion7();
        var digest = hasher.Hash(id, EmailTokenRecord.VerifyEmail, "123456");

        Assert.Equal(32, digest.Length);
        Assert.True(hasher.Matches(id, EmailTokenRecord.VerifyEmail, "123456", digest));
        Assert.False(hasher.Matches(id, EmailTokenRecord.VerifyEmail, "123457", digest));
        Assert.False(hasher.Matches(Guid.CreateVersion7(), EmailTokenRecord.VerifyEmail, "123456", digest));
        Assert.False(hasher.Matches(id, EmailTokenRecord.PasswordReset, "123456", digest));
        Assert.False(other.Matches(id, EmailTokenRecord.VerifyEmail, "123456", digest));
        Assert.NotEqual(SHA256.HashData("123456"u8), digest);
        Assert.Throws<InvalidOperationException>(() => new EmailCodeHasher(new byte[16]));

        var codes = Enumerable.Range(0, 2000).Select(_ => EmailCodeHasher.NewCode()).ToArray();
        Assert.All(codes, code => Assert.True(EmailCodeHasher.LooksValid(code)));
        Assert.True(codes.Distinct().Count() > 1900);
    }

    [Fact]
    public async Task ResendPastTheDailyCapAnswersTheSameButSendsNothing()
    {
        var email = NewEmail("tavan");
        using (var registered = await Client().PostRegisterAsync(email))
        {
            Assert.Equal(HttpStatusCode.Accepted, registered.StatusCode);
        }

        var user = factory.Store.Users.Single(u => u.Email == email);
        for (var i = 0; i < 9; i++)
        {
            Assert.True(await store.StoreEmailTokenAsync(
                TestEmailCodes.New(user.Id, EmailTokenRecord.VerifyEmail, DateTimeOffset.UtcNow).Record, Ct));
        }

        var mails = factory.Outbox.For(email).Count;
        using var capped = await Client().ResendVerificationAsync(email);

        Assert.Equal(HttpStatusCode.Accepted, capped.StatusCode);
        Assert.Equal("{\"status\":\"verification_pending\"}", await capped.Content.ReadAsStringAsync(Ct));
        Assert.Equal(mails, factory.Outbox.For(email).Count);
        Assert.Equal(10, store.Inner.CodeCount(EmailTokenRecord.VerifyEmail));
    }


    private HttpClient Client() => factory.CreateApiClient($"198.51.100.{Interlocked.Increment(ref peer) % 200 + 1}");

    private Task<HttpResponseMessage> ResetAsync(string email, string code) =>
        Client().PostAsJsonAsync("/v1/auth/reset", new ResetPasswordRequest(email, code, NewPassword), Ct);

    private static async Task<string> WithoutTraceIdAsync(HttpResponseMessage response)
    {
        var json = JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!.AsObject();
        Assert.True(json.Remove("traceId"));
        return json.ToJsonString(new JsonSerializerOptions { WriteIndented = false });
    }

    private static string[] HeaderNames(HttpResponseMessage response) =>
        [.. response.Headers.Select(h => h.Key).Concat(response.Content.Headers.Select(h => h.Key)).Order(StringComparer.Ordinal)];
}
