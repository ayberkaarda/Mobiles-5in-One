namespace Patika.Web.Routing;

public static class Routes
{
    public const string Home = "/";
    public const string Adoptions = "/sahiplendirme";
    public const string AdoptionPattern = "/sahiplendirme/{slug}";
    public const string ProvincePattern = "/istasyonlar/{il}";
    public const string DistrictPattern = "/istasyonlar/{il}/{ilce}";
    public const string CarePlaces = "/bakim-yerleri";
    public const string CarePlacePattern = "/bakim-yeri/{slug}";
    public const string Guides = "/rehber";
    public const string GuidePattern = "/rehber/{slug}";
    public const string Impact = "/etki";
    public const string Privacy = "/gizlilik";
    public const string Kvkk = "/kvkk";
    public const string Terms = "/kosullar";
    public const string DeleteAccount = "/hesap-silme";
    public const string About = "/hakkinda";
    public const string Faq = "/sss";
    public const string Contact = "/iletisim";
    public const string NotFound = "/404";

    private static string Segment(string value) => Uri.EscapeDataString(value.Trim('/').ToLowerInvariant());
    public static string Adoption(string slug) => $"{Adoptions}/{Segment(slug)}";
    public static string Province(string provinceSlug) => $"/istasyonlar/{Segment(provinceSlug)}";
    public static string District(string provinceSlug, string districtSlug) => $"{Province(provinceSlug)}/{Segment(districtSlug)}";
    public static string CarePlace(string slug) => $"/bakim-yeri/{Segment(slug)}";
    public static string Guide(string slug) => $"{Guides}/{Segment(slug)}";
}
