using System.Text.Json;
using Patika.App.Services.Billing;
using Patika.App.ViewModels.Billing;

namespace Patika.App.Pages.Billing;

public partial class DestekciPage : ContentPage
{
    private readonly DestekciViewModel model;
    public DestekciPage(DestekciViewModel model)
    {
        InitializeComponent();
        BindingContext = this.model = model;
    }
    protected override async void OnAppearing() { base.OnAppearing(); await model.LoadAsync(); }
    private async void PurchaseClicked(object? sender, EventArgs e)
    {
        // Stands in for the Google Play purchase sheet; nothing is charged in this build.
        var plan = model.SelectedProduct;
        if (plan is null) return;
        var message = $"Patika Destekçi · {plan.Title} · {plan.Price} (örnek fiyat).\nOtomatik yenilenir, Google Play'den iptal edebilirsin.";
        if (await DisplayAlertAsync("Test ödemesi — gerçek ücret alınmaz", message, "Test satın alımını onayla", "Vazgeç"))
            await model.PurchaseCommand.ExecuteAsync(null);
    }
    private async void ManageClicked(object? sender, EventArgs e) => await Launcher.Default.OpenAsync("https://play.google.com/store/account/subscriptions?sku=patika_destekci&package=app.patika.android");
    private async void PrivacyClicked(object? sender, EventArgs e) => await Launcher.Default.OpenAsync("https://patika.app/gizlilik");
    private async void TermsClicked(object? sender, EventArgs e) => await Launcher.Default.OpenAsync("https://patika.app/kosullar");
}

public sealed class SecureBillingPurchaseStore : IBillingPurchaseStore
{
    public async Task<IReadOnlyList<BillingPurchase>> ReadAsync(string userId)
    {
        var json = await SecureStorage.Default.GetAsync("billing." + userId);
        return json is null ? [] : JsonSerializer.Deserialize<BillingPurchase[]>(json) ?? [];
    }
    public Task WriteAsync(string userId, IReadOnlyList<BillingPurchase> purchases) =>
        SecureStorage.Default.SetAsync("billing." + userId, JsonSerializer.Serialize(purchases));
}
