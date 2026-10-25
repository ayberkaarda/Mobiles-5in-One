namespace Patika.App;

internal static class StatusBar
{
    public static void UseDarkIcons(bool dark)
    {
#if ANDROID
        var window = Platform.CurrentActivity?.Window;
        if (window is null)
        {
            return;
        }

        var controller = AndroidX.Core.View.WindowCompat.GetInsetsController(window, window.DecorView);
        if (controller is not null)
        {
            controller.AppearanceLightStatusBars = dark;
        }
#else
        _ = dark;
#endif
    }
}
