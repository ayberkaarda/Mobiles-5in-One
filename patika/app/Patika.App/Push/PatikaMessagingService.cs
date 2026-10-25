using Android.App;
using Android.Content;
using AndroidX.Core.App;
using Firebase.Messaging;
using Patika.App.Core.Push;

// Android 13+ asks before showing notifications; older versions grant this at install.
[assembly: UsesPermission("android.permission.POST_NOTIFICATIONS")]

// Messages without a channel (and FCM's own tray notifications) land on the general channel.
[assembly: MetaData("com.google.firebase.messaging.default_notification_channel_id", Value = Patika.App.Push.NotificationChannels.General)]

namespace Patika.App.Push;

/// <summary>
/// Receives FCM messages. Data-only messages (the server's format) always come here and are shown with fixed
/// text; a tap opens the app with only the validated type and post id as intent extras. A message that still
/// carries a notification block is shown by Android itself while the app is in the background.
/// Rotated tokens go to <see cref="FcmPushTokenProvider"/>, which re-registers the device.
/// </summary>
[Service(Exported = false)]
[IntentFilter(["com.google.firebase.MESSAGING_EVENT"])]
public sealed class PatikaMessagingService : FirebaseMessagingService
{
    public override void OnNewToken(string token)
    {
        base.OnNewToken(token);
        FcmPushTokenProvider.Current?.OnNewToken(token);
    }

    public override void OnMessageReceived(RemoteMessage message)
    {
        base.OnMessageReceived(message);
        // Data-only messages arrive here in the foreground and the background alike. The payload's own title and
        // body (if any) are ignored: the text comes from the allowlisted type, and unknown types show nothing.
        var data = new Dictionary<string, string>(message.Data ?? new Dictionary<string, string>());
        if (NotificationContent.From(data) is { } content)
        {
            Show(this, content.Title, content.Body, content.Target, NotificationChannels.Urgent);
        }
    }

    internal static void Show(Context context, string title, string body, NotificationTarget? target, string? channelId)
    {
        NotificationChannels.Ensure(context);
        var channel = channelId ?? (target is null ? NotificationChannels.General : NotificationChannels.Urgent);

        var launch = context.PackageManager?.GetLaunchIntentForPackage(context.PackageName ?? "");
        if (launch is null)
        {
            return;
        }

        launch.AddFlags(ActivityFlags.SingleTop | ActivityFlags.ClearTop);
        if (target is not null)
        {
            launch.PutExtra(NotificationTarget.TypeKey, target.Kind);
            launch.PutExtra(NotificationTarget.UrgentIdKey, target.Id.ToString("D"));
        }

        var requestCode = target?.Id.GetHashCode() ?? 0;
        var pending = PendingIntent.GetActivity(context, requestCode, launch,
            PendingIntentFlags.Immutable | PendingIntentFlags.UpdateCurrent);

        var builder = new NotificationCompat.Builder(context, channel);
        builder.SetSmallIcon(context.ApplicationInfo?.Icon ?? Android.Resource.Drawable.StatNotifyMore);
        builder.SetContentTitle(title);
        builder.SetContentText(body);
        builder.SetStyle(new NotificationCompat.BigTextStyle().BigText(body));
        builder.SetAutoCancel(true);
        builder.SetPriority(channel == NotificationChannels.Urgent ? NotificationCompat.PriorityHigh : NotificationCompat.PriorityDefault);
        builder.SetContentIntent(pending);
        var built = builder.Build();

        var manager = NotificationManagerCompat.From(context);
        if (built is not null && manager?.AreNotificationsEnabled() == true)
        {
            manager.Notify(requestCode, built);
        }
    }
}

/// <summary>The two channels the worker addresses: <c>urgent</c> (high importance) and <c>general</c>.</summary>
public static class NotificationChannels
{
    public const string Urgent = "urgent";
    public const string General = "general";

    public static void Ensure(Context context)
    {
        if (!OperatingSystem.IsAndroidVersionAtLeast(26)
            || context.GetSystemService(Context.NotificationService) is not NotificationManager manager)
        {
            return;
        }

        manager.CreateNotificationChannel(new NotificationChannel(Urgent, "Acil yardım çağrıları", NotificationImportance.High)
        {
            Description = "Ev bölgende biri yaralı ya da sıkışmış bir hayvan için yardım isteyince.",
        });
        manager.CreateNotificationChannel(new NotificationChannel(General, "Genel", NotificationImportance.Default)
        {
            Description = "Takip ettiğin hayvanlar ve hesabınla ilgili haberler.",
        });
    }
}
