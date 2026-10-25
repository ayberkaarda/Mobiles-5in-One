using CommunityToolkit.Mvvm.ComponentModel;
using Patika.App.Core.Api;

namespace Patika.App.Core.Mvvm;

/// <summary>
/// Base for every view model: a busy flag, one Turkish error line, and <see cref="RunAsync"/> which turns an
/// <see cref="ApiException"/> into that line. A session that ended is handled centrally (the app routes to
/// sign-in), so view models only show the message.
/// </summary>
public abstract partial class ViewModelBase : ObservableObject
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsNotBusy))]
    public partial bool IsBusy { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    public partial string? ErrorMessage { get; set; }

    public bool IsNotBusy => !IsBusy;

    public bool HasError => ErrorMessage is { Length: > 0 };

    /// <summary>Runs <paramref name="work"/> once at a time; returns false if it failed or was already running.</summary>
    protected async Task<bool> RunAsync(Func<Task> work)
    {
        if (IsBusy)
        {
            return false;
        }

        IsBusy = true;
        ErrorMessage = null;
        try
        {
            await work();
            return true;
        }
        catch (ApiException e)
        {
            ErrorMessage = e.Message;
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }
}
