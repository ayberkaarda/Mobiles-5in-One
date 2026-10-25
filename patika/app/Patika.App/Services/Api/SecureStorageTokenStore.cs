using Patika.App.Core.Api;

namespace Patika.App.Services.Api;

/// <summary>
/// Refresh token and account id in SecureStorage (Android Keystore-backed EncryptedSharedPreferences).
/// The access token never reaches storage. A read that fails (keystore reset after a restore) clears the
/// entries so the user simply signs in again.
/// </summary>
public sealed class SecureStorageTokenStore : ITokenStore
{
    private const string RefreshKey = "patika.refresh_token";
    private const string UserKey = "patika.user_id";

    public async Task<StoredSession?> GetAsync()
    {
        try
        {
            var refresh = await SecureStorage.Default.GetAsync(RefreshKey);
            if (refresh is null || refresh.Length == 0)
            {
                return null;
            }

            return new StoredSession(refresh, await SecureStorage.Default.GetAsync(UserKey));
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            SecureStorage.Default.RemoveAll();
            return null;
        }
    }

    public async Task SetAsync(StoredSession session)
    {
        await SecureStorage.Default.SetAsync(RefreshKey, session.RefreshToken);
        if (session.UserId is { } user)
        {
            await SecureStorage.Default.SetAsync(UserKey, user);
        }
    }

    public Task ClearAsync()
    {
        SecureStorage.Default.Remove(RefreshKey);
        SecureStorage.Default.Remove(UserKey);
        return Task.CompletedTask;
    }
}
