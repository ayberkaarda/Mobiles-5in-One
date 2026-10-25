using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging.Abstractions;
using Patika.Api.Security.Passwords;
using Xunit;

namespace Patika.Api.Tests;

public sealed class PasswordHashingTests
{
    private static readonly Argon2idPasswordHasher Hasher = new();
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task HashUsesArgon2idPhcFormatWithSpecParameters()
    {
        var hash = await Hasher.HashAsync("tekir-ve-pamuk-2026", Ct);

        Assert.Matches(new Regex(@"^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$"), hash);
        Assert.True(Argon2idPasswordHasher.TryDecode(hash, out var m, out var t, out var p, out var salt, out var tag));
        Assert.Equal((65536, 3, 1), (m, t, p));
        Assert.Equal(16, salt.Length);
        Assert.Equal(32, tag.Length);
        Assert.False(Argon2idPasswordHasher.NeedsRehash(hash));
        Assert.DoesNotContain("tekir", hash, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SamePasswordGetsUniqueSaltAndVerifiesOnlyWithTheRightPassword()
    {
        var first = await Hasher.HashAsync("tekir-ve-pamuk-2026", Ct);
        var second = await Hasher.HashAsync("tekir-ve-pamuk-2026", Ct);

        Assert.NotEqual(first, second);
        Assert.True(await Hasher.VerifyAsync("tekir-ve-pamuk-2026", first, Ct));
        Assert.True(await Hasher.VerifyAsync("tekir-ve-pamuk-2026", second, Ct));
        Assert.False(await Hasher.VerifyAsync("tekir-ve-pamuk-2027", first, Ct));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("plain-text")]
    [InlineData("$argon2i$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g")]
    [InlineData("$argon2id$v=19$m=99999999,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g")]
    [InlineData("$argon2id$v=19$m=65536,t=99,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g")]
    public async Task MissingOrTamperedHashNeverVerifies(string? stored)
    {
        Assert.False(await Hasher.VerifyAsync("anything-at-all-1", stored, Ct));
    }

    [Fact]
    public async Task UnknownUserVerificationStillPaysTheHashCost()
    {
        var hash = await Hasher.HashAsync("tekir-ve-pamuk-2026", Ct);
        await Hasher.VerifyAsync("warm-up-password", null, Ct);

        var known = await MeasureAsync(() => Hasher.VerifyAsync("wrong-password-1", hash, Ct));
        var unknown = await MeasureAsync(() => Hasher.VerifyAsync("wrong-password-1", null, Ct));

        // Both paths run Argon2id with identical parameters; allow wide jitter on shared machines.
        Assert.InRange(unknown.TotalMilliseconds, known.TotalMilliseconds * 0.4, known.TotalMilliseconds * 2.5);
    }

    private static async Task<TimeSpan> MeasureAsync(Func<Task<bool>> action)
    {
        var best = TimeSpan.MaxValue;
        for (var i = 0; i < 3; i++)
        {
            var started = System.Diagnostics.Stopwatch.GetTimestamp();
            await action();
            var elapsed = System.Diagnostics.Stopwatch.GetElapsedTime(started);
            best = elapsed < best ? elapsed : best;
        }

        return best;
    }
}

public sealed class BreachedPasswordCheckerTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public void OnlyTheFiveCharacterPrefixLeavesTheProcess()
    {
        var (prefix, suffix) = HibpBreachedPasswordChecker.Split("password");

        Assert.Equal("5BAA6", prefix);
        Assert.Equal("1E4C9B93F3F0682250B6CF8331B7EE68FD8", suffix);
    }

    [Fact]
    public async Task BreachedPasswordIsDetectedFromRangeResponse()
    {
        var handler = new StubHandler(HttpStatusCode.OK,
            "0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0");
        var checker = Create(handler);

        Assert.True(await checker.IsBreachedAsync("password", Ct));
        Assert.Equal("/range/5BAA6", handler.LastRequest!.RequestUri!.AbsolutePath);
        Assert.Equal("true", handler.LastRequest.Headers.GetValues("Add-Padding").Single());
        Assert.DoesNotContain("1E4C9B93", handler.LastRequest.RequestUri.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task PaddingEntriesWithZeroCountAreNotBreaches()
    {
        var checker = Create(new StubHandler(HttpStatusCode.OK, "1E4C9B93F3F0682250B6CF8331B7EE68FD8:0"));

        Assert.False(await checker.IsBreachedAsync("password", Ct));
    }

    [Fact]
    public async Task ServiceFailureFailsOpen()
    {
        Assert.False(await Create(new StubHandler(HttpStatusCode.ServiceUnavailable, "")).IsBreachedAsync("password", Ct));
        Assert.False(await Create(new StubHandler(null, "")).IsBreachedAsync("password", Ct));
    }

    private static HibpBreachedPasswordChecker Create(StubHandler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("https://hibp.invalid/") },
            NullLogger<HibpBreachedPasswordChecker>.Instance);

    private sealed class StubHandler(HttpStatusCode? status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            if (status is null)
            {
                throw new HttpRequestException("offline");
            }

            return Task.FromResult(new HttpResponseMessage(status.Value) { Content = new StringContent(body) });
        }
    }
}
