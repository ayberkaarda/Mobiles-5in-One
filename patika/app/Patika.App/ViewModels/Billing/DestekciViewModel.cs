using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Patika.App.Core.Api;
using Patika.App.Core.Mvvm;
using Patika.App.Services.Billing;
using Patika.Contracts.Subscriptions;

namespace Patika.App.ViewModels.Billing;

/// <summary>One plan card on the paywall.</summary>
public sealed partial class PlanOption(BillingProduct product, string period, string renewal) : ObservableObject
{
    public BillingProduct Product { get; } = product;
    public string Period { get; } = period;
    public string Renewal { get; } = renewal;
    [ObservableProperty] public partial bool IsSelected { get; set; }
}

public sealed partial class DestekciViewModel(IBillingClient billing, ISubscriptionApi api) : ViewModelBase
{
    public ObservableCollection<BillingProduct> Products { get; } = [];
    public ObservableCollection<PlanOption> Plans { get; } = [];
    [ObservableProperty] public partial BillingProduct? SelectedProduct { get; set; }
    [ObservableProperty] public partial string State { get; set; } = "idle";
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanPurchase))]
    public partial bool Supporter { get; set; }
    [ObservableProperty] public partial string EntitlementText { get; set; } = "";
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasNotice))]
    public partial string? Notice { get; set; }

    public bool HasNotice => Notice is { Length: > 0 };

    /// <summary>An active supporter manages the plan in Google Play instead of buying a second one.</summary>
    public bool CanPurchase => !Supporter;

    public Task LoadAsync() => ExecuteAsync("loading", async () =>
    {
        Products.Clear();
        Plans.Clear();
        foreach (var product in await billing.QueryProducts())
        {
            Products.Add(product);
            Plans.Add(product.BasePlanId == "yillik"
                ? new PlanOption(product, "Yıllık", "Her yıl otomatik yenilenir")
                : new PlanOption(product, "Aylık", "Her ay otomatik yenilenir"));
        }
        SelectPlan(Plans.FirstOrDefault());
        Show(await api.Entitlement());
        State = "products";
    });

    [RelayCommand]
    private void SelectPlan(PlanOption? plan)
    {
        if (plan is null) return;
        foreach (var option in Plans) option.IsSelected = ReferenceEquals(option, plan);
        SelectedProduct = plan.Product;
    }

    [RelayCommand]
    private Task PurchaseAsync() => ExecuteAsync("purchasing", async () =>
    {
        if (SelectedProduct is null) throw new InvalidOperationException("Bir plan seç.");
        // Play records this server-issued id with the purchase, which binds it to this Patika account.
        var account = (await api.Entitlement()).BillingAccountId ?? throw new InvalidOperationException("Satın alma şu an başlatılamıyor.");
        Show(await api.Verify(await billing.LaunchPurchase(SelectedProduct, account)));
        Notice = Supporter ? "Teşekkürler! Destekçi rozetin profilinde." : null;
        State = "success";
    });

    [RelayCommand]
    private Task RestoreAsync() => ExecuteAsync("restore", async () =>
    {
        var purchases = await billing.QueryPurchases();
        string? failure = null;
        foreach (var purchase in purchases)
        {
            // An old, replaced or foreign purchase must not stop the others from being restored.
            try { await api.Verify(purchase); }
            catch (ApiException e) { failure = e.Code; }
        }
        Show(await api.Entitlement());
        Notice = purchases.Count == 0 ? "Bu cihazda geri yüklenecek satın alım yok."
            : Supporter ? "Satın alımların geri yüklendi."
            : SupporterText.Failure(failure);
        State = "success";
    });

    private void Show(EntitlementResponse entitlement)
    {
        Supporter = entitlement.Supporter;
        EntitlementText = SupporterText.Describe(entitlement);
    }

    private async Task ExecuteAsync(string state, Func<Task> work)
    {
        if (IsBusy) return;
        IsBusy = true;
        ErrorMessage = null;
        Notice = null;
        State = state;
        try { await work(); }
        catch (ApiException e) when (e.Status is 400 or 409)
        {
            ErrorMessage = SupporterText.Failure(e.Code);
            State = "error";
        }
        catch (Exception e) when (e is ApiException or InvalidOperationException or HttpRequestException)
        {
            ErrorMessage = e.Message;
            State = "error";
        }
        finally { IsBusy = false; }
    }
}
