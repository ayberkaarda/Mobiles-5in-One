using Patika.App.Core.Navigation;

namespace Patika.App.Services.Navigation;

/// <summary><see cref="INavigationService"/> over Shell; always runs on the UI thread.</summary>
public sealed class ShellNavigationService : INavigationService
{
    public Task GoToAsync(string route, IDictionary<string, object>? parameters = null) =>
        MainThread.InvokeOnMainThreadAsync(async () =>
        {
            var shell = Shell.Current;
            await (parameters is null ? shell.GoToAsync(route) : shell.GoToAsync(route, parameters));
            if (route == Routes.SignIn)
            {
                DropSignedInPages(shell);
            }
        });

    public Task GoBackAsync() => MainThread.InvokeOnMainThreadAsync(() => Shell.Current.GoToAsync(".."));

    /// <summary>
    /// Going to sign-in ends the session: Shell keeps each tab's pushed pages, so without this the next
    /// account would land on the previous one's screens (account deletion, a station, a post).
    /// </summary>
    private static void DropSignedInPages(Shell shell)
    {
        foreach (var section in shell.Items.Where(item => item is TabBar).SelectMany(item => item.Items))
        {
            foreach (var page in section.Navigation.NavigationStack.Skip(1).Where(page => page is not null).ToList())
            {
                section.Navigation.RemovePage(page);
            }
        }
    }
}
