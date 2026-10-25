using System.Security.Cryptography;
using Patika.Api.Features.Auth;
using Xunit;

namespace Patika.Api.Tests.Auth;

/// <summary>A per-process code key and helpers to issue and match six-digit codes against any store.</summary>
internal static class TestEmailCodes
{
    public static readonly EmailCodeHasher Hasher = new(RandomNumberGenerator.GetBytes(32));

    public static (string Code, EmailTokenRecord Record) New(
        Guid userId, string purpose, DateTimeOffset now, TimeSpan? lifetime = null)
    {
        var code = EmailCodeHasher.NewCode();
        var id = Guid.CreateVersion7();
        return (code, new EmailTokenRecord(id, userId, Hasher.Hash(id, purpose, code), purpose, now,
            now + (lifetime ?? EmailCodeHasher.Lifetime)));
    }

    public static EmailCodeMatcher Matcher(string purpose, string code) =>
        (codeId, storedHash) => Hasher.Matches(codeId, purpose, code, storedHash);

    public static async Task<string> IssueAsync(
        IAuthStore store, Guid userId, string purpose, DateTimeOffset now, CancellationToken ct)
    {
        var (code, record) = New(userId, purpose, now);
        Assert.True(await store.StoreEmailTokenAsync(record, ct));
        return code;
    }

    /// <summary>A six-digit code different from <paramref name="code"/>.</summary>
    public static string Other(string code) =>
        ((int.Parse(code, System.Globalization.CultureInfo.InvariantCulture) + 1) % 1_000_000)
            .ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
}
