using Android.Gms.Extensions;
using Firebase;
using Firebase.Messaging;
using Patika.App.Core.Push;

namespace Patika.App.Push;

/// <summary>
/// FCM registration tokens. Firebase starts itself from the values that <c>google-services.json</c> adds to
/// the build; without that file no Firebase app exists, <see cref="TryCreate"/> returns null and the app
/// registers <see cref="NoPushTokenProvider"/> instead.
/// </summary>
public sealed class FcmPushTokenProvider : IPushTokenProvider
{
    private FcmPushTokenProvider()
    {
    }

    /// <summary>The instance the messaging service reports rotated tokens to (null when push is off).</summary>
    internal static FcmPushTokenProvider? Current { get; private set; }

    public bool IsAvailable => true;

    public event EventHandler<string>? TokenChanged;

    public static FcmPushTokenProvider? TryCreate()
    {
        try
        {
            var context = Android.App.Application.Context;
            if (FirebaseApp.GetApps(context).Count == 0 && FirebaseApp.InitializeApp(context) is null)
            {
                return null;
            }
        }
        catch (Java.Lang.Exception)
        {
            return null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }

        return Current = new FcmPushTokenProvider();
    }

    public async Task<string?> GetTokenAsync(CancellationToken ct = default)
    {
        try
        {
            var token = await FirebaseMessaging.Instance.GetToken().AsAsync<Java.Lang.String>().WaitAsync(ct);
            return token?.ToString() is { Length: > 0 } value ? value : null;
        }
        catch (Java.Lang.Exception)
        {
            // No Google Play services, or FCM unreachable: registration retries on the next sign-in or resume.
            return null;
        }
    }

    public async Task DeleteTokenAsync(CancellationToken ct = default)
    {
        try
        {
            await FirebaseMessaging.Instance.DeleteToken().AsAsync<Java.Lang.Object>().WaitAsync(ct);
        }
        catch (Java.Lang.Exception)
        {
            // No Google Play services or offline: nothing more this device can do.
        }
    }

    internal void OnNewToken(string token) => TokenChanged?.Invoke(this, token);
}
