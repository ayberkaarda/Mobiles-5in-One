namespace Patika.App.Pages.Common;

/// <summary>
/// Stand-in for a canvas screen whose package has not landed yet. The route is real, so navigation and
/// deep links work today; the owning package replaces the subclass with its own page.
/// </summary>
public abstract class PlaceholderPage : ContentPage
{
    protected PlaceholderPage(string title, string summary)
    {
        Title = title;
        Shell.SetNavBarIsVisible(this, true);
        Content = new VerticalStackLayout
        {
            Padding = new Thickness(24),
            Spacing = 12,
            Children =
            {
                new Label { Text = title, Style = (Style)Application.Current!.Resources["Display"] },
                new Label { Text = summary, Style = (Style)Application.Current.Resources["Lede"] },
                new Label { Text = "Bu ekran bir sonraki sürümde geliyor.", Style = (Style)Application.Current.Resources["Muted"] },
            },
        };
    }
}

// Package B: map and stations.
public sealed class FedPage() : PlaceholderPage("Beslendi", "Besleme kaydın alındı.");

public sealed class CooldownPage() : PlaceholderPage("Biraz bekle", "Aynı istasyonu 30 dakika içinde yeniden kaydedemezsin.");

public sealed class AddStationPage() : PlaceholderPage("İstasyon ekle", "Haritaya iğne bırak, türü seç ve bir fotoğraf ekle.");

// Package C: animals and adoption.
public sealed class AnimalPage() : PlaceholderPage("Hayvan profili", "Sağlık bilgileri, görülmeler ve takip.");

public sealed class AdoptionPostPage() : PlaceholderPage("İlan", "Sahiplendirme ilanının ayrıntısı.");

public sealed class AdoptionRequestPage() : PlaceholderPage("Sahiplenme talebi", "İlan sahibine kısa bir mesaj yaz.");

// Package D: urgent help and account.
public sealed class UrgentNewPage() : PlaceholderPage("Acil yardım çağrısı", "Fotoğraf, kategori, not ve şu anki konum.");

public sealed class UrgentSettingsPage() : PlaceholderPage("Acil bildirimleri", "Ev bölgen ve bildirim yarıçapı.");

public sealed class SettingsPage() : PlaceholderPage("Ayarlar", "Bildirimler, gizlilik ve hesap.");

public sealed class DeleteAccountPage() : PlaceholderPage("Hesabı sil", "7 gün içinde geri alabilirsin.");
