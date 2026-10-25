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
    private readonly Dictionary<Guid, EmailCodeEntry> emailTokens = [];

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
                emailTokens[emailToken.Id] = new EmailCodeEntry(emailToken);
            }

            if (login is not null)
            {
                logins[login] = user.Id;
            }

            return true;
        });

    public Task<Guid?> TryRedeemEmailCodeAsync(
        Guid userId, string purpose, EmailCodeMatcher matches, DateTimeOffset now, CancellationToken cancellationToken) =>
        Run(() =>
        {
            var redeemed = RedeemLocked(userId, purpose, matches, now);
            if (redeemed is not null && purpose == EmailTokenRecord.VerifyEmail && users.TryGetValue(userId, out var user))
            {
                users[user.Id] = user with { EmailVerifiedAt = user.EmailVerifiedAt ?? now };
            }

            return redeemed;
        });

    /// <summary>
    /// Same rules as the EF store: the newest unused, unexpired code with fewer than
    /// <see cref="EmailCodeHasher.MaxAttempts"/> wrong guesses; a wrong guess counts and the last one burns it.
    /// </summary>
    public Guid? RedeemCode(Guid userId, string purpose, EmailCodeMatcher matches, DateTimeOffset now)
    {
        lock (gate)
        {
            return RedeemLocked(userId, purpose, matches, now);
        }
    }

    private Guid? RedeemLocked(Guid userId, string purpose, EmailCodeMatcher matches, DateTimeOffset now)
    {
        var live = emailTokens.Values
            .Where(e => e.Token.UserId == userId && e.Token.Purpose == purpose && e.UsedAt is null
                && e.Token.ExpiresAt > now && e.FailedAttempts < EmailCodeHasher.MaxAttempts)
            .OrderByDescending(e => e.Token.CreatedAt)
            .FirstOrDefault();
        if (live is null)
        {
            return null;
        }

        if (matches(live.Token.Id, live.Token.TokenHash))
        {
            live.UsedAt = now;
            return userId;
        }

        live.FailedAttempts++;
        if (live.FailedAttempts >= EmailCodeHasher.MaxAttempts)
        {
            live.UsedAt = now;
        }

        return null;
    }

    public Task<bool> StoreEmailTokenAsync(EmailTokenRecord token, CancellationToken cancellationToken) =>
        Run(() =>
        {
            var since = token.CreatedAt - EmailCodeHasher.IssueWindow;
            if (!users.ContainsKey(token.UserId)
                || emailTokens.Values.Count(e => e.Token.UserId == token.UserId && e.Token.Purpose == token.Purpose
                    && e.Token.CreatedAt > since) >= EmailCodeHasher.MaxIssuedPerWindow)
            {
                return false;
            }

            InvalidateUnusedLocked(token.UserId, token.Purpose, token.CreatedAt);
            emailTokens[token.Id] = new EmailCodeEntry(token);
            return true;
        });

    /// <summary>Marks the user's unused codes of the purpose used (the reset path does this after success).</summary>
    public void RemoveUnusedCodes(Guid userId, string purpose)
    {
        lock (gate)
        {
            InvalidateUnusedLocked(userId, purpose, DateTimeOffset.UtcNow);
        }
    }

    private void InvalidateUnusedLocked(Guid userId, string purpose, DateTimeOffset now)
    {
        foreach (var entry in emailTokens.Values.Where(e => e.Token.UserId == userId && e.Token.Purpose == purpose && e.UsedAt is null))
        {
            entry.UsedAt = now;
        }
    }

    /// <summary>Codes of the purpose that are still unused.</summary>
    public int LiveCodeCount(string purpose)
    {
        lock (gate)
        {
            return emailTokens.Values.Count(e => e.Token.Purpose == purpose && e.UsedAt is null);
        }
    }

    public int CodeCount(string purpose)
    {
        lock (gate)
        {
            return emailTokens.Values.Count(e => e.Token.Purpose == purpose);
        }
    }

    public int FailedAttempts(Guid userId, string purpose)
    {
        lock (gate)
        {
            return emailTokens.Values.Where(e => e.Token.UserId == userId && e.Token.Purpose == purpose)
                .Select(e => e.FailedAttempts).DefaultIfEmpty(0).Max();
        }
    }

    public void ExpireEmailTokens(string? purpose = null)
    {
        lock (gate)
        {
            foreach (var entry in emailTokens.Values.Where(e => purpose is null || e.Token.Purpose == purpose))
            {
                entry.Token = entry.Token with { ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1) };
            }
        }
    }

    private sealed class EmailCodeEntry(EmailTokenRecord token)
    {
        public EmailTokenRecord Token { get; set; } = token;

        public DateTimeOffset? UsedAt { get; set; }

        public int FailedAttempts { get; set; }
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
