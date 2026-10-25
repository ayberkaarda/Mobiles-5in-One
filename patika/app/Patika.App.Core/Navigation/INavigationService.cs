namespace Patika.App.Core.Navigation;

/// <summary>Shell navigation behind an interface so view models stay testable.</summary>
public interface INavigationService
{
    /// <summary>Goes to <paramref name="route"/> (see <see cref="Routes"/>) with optional query parameters.</summary>
    Task GoToAsync(string route, IDictionary<string, object>? parameters = null);

    Task GoBackAsync();
}

/// <summary>
/// Every screen of the canvas has a route. Tabs and sign-in are absolute (<c>//</c>); the rest are pushed.
/// </summary>
public static class Routes
{
    public const string SignIn = "//giris";
    public const string Map = "//harita";
    public const string Adopt = "//sahiplen";
    public const string Urgent = "//acil";
    public const string Profile = "//profil";

    public const string SignUp = "kayit";
    public const string Verify = "dogrulama";
    public const string Station = "istasyon";
    public const string Fed = "beslendi";
    public const string Cooldown = "bekleme";
    public const string AddStation = "istasyon-ekle";
    public const string Outbox = "giden-kutusu";
    public const string Animal = "hayvan";
    public const string AdoptionPost = "ilan";
    public const string AdoptionRequest = "talep";
    public const string UrgentNew = "acil-yeni";
    public const string UrgentSettings = "acil-ayar";
    public const string Settings = "ayarlar";
    public const string DeleteAccount = "hesap-sil";

    /// <summary>Query keys used between screens.</summary>
    public static class Keys
    {
        public const string Id = "id";
        public const string Email = "email";
    }
}
