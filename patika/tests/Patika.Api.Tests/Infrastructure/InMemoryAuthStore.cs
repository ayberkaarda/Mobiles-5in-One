using Patika.Api.Features.Auth;
using Patika.Domain.Security;

namespace Patika.Api.Tests.Infrastructure;

/// <summary>Thread-safe in-memory <see cref="IAuthStore"/> with the same uniqueness and rotation semantics.</summary>
public sealed class InMemoryAuthStore : IAuthStore
{
    private readonly Lock gate = new();
    private readonly Dictionary<Guid, AuthUser> users = [];
    private readonly Dictionary<ExternalLoginKey, Guid> logins = [];
    private readonly Dictionary<Guid, RefreshTokenRecord> tokens = [];
    private readonly Dictionary<Guid, (EmailTokenRecord Token, DateTimeOffset? UsedAt)> emailTokens = [];

    /// <summary>When set, every store call throws (used to force a server error).</summary>
    public Exception? FailWith { get; set; }

    public IReadOnlyList<AuthUser> Users
    {
        get
        {
            lock (gate)
            {
                return [.. users.Values];
            }
        }
    }

    public IReadOnlyList<RefreshTokenRecord> Tokens
    {
        get
        {
            lock (gate)
            {
                return [.. tokens.Values];
            }
        }
    }

    public void Update(Guid userId, Func<AuthUser, AuthUser> change)
    {
        lock (gate)
        {
            users[userId] = change(users[userId]);
        }
    }

    public Task<AuthUser?> FindUserByIdAsync(Guid userId, CancellationToken cancellationToken) =>
        Run(() => users.GetValueOrDefault(userId));

    public Task<AuthUser?> FindUserByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
        Run(() => users.Values.SingleOrDefault(u => u.Email == normalizedEmail));

    public Task<AuthUser?> FindUserByExternalLoginAsync(ExternalLoginKey login, CancellationToken cancellationToken) =>
        Run(() => logins.TryGetValue(login, out var id) ? users.GetValueOrDefault(id) : null);

    public Task<bool> TryCreateUserAsync(
        AuthUser user, ExternalLoginKey? login, EmailTokenRecord? emailToken, CancellationToken cancellationToken) =>
        Run(() =>
        {
            if (user.Email is not null && users.Values.Any(u => u.Email == user.Email))
            {
                return false;
            }

            if (login is not null && logins.ContainsKey(login))
            {
                return false;
            }

            users[user.Id] = user;
            if (emailToken is not null)
            {
                emailTokens[emailToken.Id] = (emailToken, null);
            }

            if (login is not null)
            {
                logins[login] = user.Id;
            }

            return true;
        });

    public Task<Guid?> TryConsumeEmailTokenAsync(
        byte[] tokenHash, string purpose, DateTimeOffset now, CancellationToken cancellationToken) =>
        Run<Guid?>(() =>
        {
            var match = emailTokens.Values.FirstOrDefault(e => e.Token.TokenHash.AsSpan().SequenceEqual(tokenHash)
                && e.Token.Purpose == purpose);
            if (match.Token is null || match.UsedAt is not null || match.Token.ExpiresAt <= now)
            {
                return null;
            }

            emailTokens[match.Token.Id] = (match.Token, now);
            if (purpose == EmailTokenRecord.VerifyEmail && users.TryGetValue(match.Token.UserId, out var user))
            {
                users[user.Id] = user with { EmailVerifiedAt = user.EmailVerifiedAt ?? now };
            }

            return match.Token.UserId;
        });

    public void ExpireEmailTokens()
    {
        lock (gate)
        {
            foreach (var (id, entry) in emailTokens.ToArray())
            {
                emailTokens[id] = (entry.Token with { ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1) }, entry.UsedAt);
            }
        }
    }

    public Task<bool> TryLinkExternalLoginAsync(
        Guid userId, ExternalLoginKey login, CancellationToken cancellationToken) =>
        Run(() => logins.TryAdd(login, userId));

    public Task AddRefreshTokenAsync(RefreshTokenRecord token, CancellationToken cancellationToken) =>
        Run(() => tokens[token.Id] = token);

    public Task<RefreshTokenRecord?> FindRefreshTokenAsync(byte[] tokenHash, CancellationToken cancellationToken) =>
        Run(() => tokens.Values.SingleOrDefault(t => t.TokenHash.AsSpan().SequenceEqual(tokenHash)));

    public Task<bool> TryRotateRefreshTokenAsync(
        Guid currentId, RefreshTokenRecord replacement, DateTimeOffset now, CancellationToken cancellationToken) =>
        Run(() =>
        {
            if (!tokens.TryGetValue(currentId, out var current) || current.RevokedAt is not null
                || tokens.Values.Any(t => t.FamilyId == current.FamilyId && t.RevokedAt is not null && t.ReplacedById is null))
            {
                return false;
            }

            tokens[currentId] = current with { RevokedAt = now, ReplacedById = replacement.Id };
            tokens[replacement.Id] = replacement;
            return true;
        });

    public Task<int> RevokeFamilyAsync(Guid familyId, DateTimeOffset now, CancellationToken cancellationToken) =>
        Run(() =>
        {
            var active = tokens.Values.Where(t => t.FamilyId == familyId && t.RevokedAt is null).ToArray();
            foreach (var token in active)
            {
                tokens[token.Id] = token with { RevokedAt = now };
            }

            return active.Length;
        });

    public AuthUser AddUser(string email, ActorRole role = ActorRole.User, string? passwordHash = null, bool verified = true)
    {
        var user = new AuthUser(Guid.CreateVersion7(), email, passwordHash, "Örnek Kullanıcı", role,
            verified ? DateTimeOffset.UtcNow : null, null);
        lock (gate)
        {
            users[user.Id] = user;
        }

        return user;
    }

    private Task<T> Run<T>(Func<T> action)
    {
        if (FailWith is { } failure)
        {
            throw failure;
        }

        lock (gate)
        {
            return Task.FromResult(action());
        }
    }
}
