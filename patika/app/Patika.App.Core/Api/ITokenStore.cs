namespace Patika.App.Core.Api;

/// <summary>
/// Durable half of the session. The app backs it with SecureStorage (Android Keystore); the access token is
/// never stored, it lives in memory only. The account id is kept so offline records stay tied to their owner.
/// </summary>
public interface ITokenStore
{
    Task<StoredSession?> GetAsync();

    Task SetAsync(StoredSession session);

    Task ClearAsync();
}

public sealed record StoredSession(string RefreshToken, string? UserId);
