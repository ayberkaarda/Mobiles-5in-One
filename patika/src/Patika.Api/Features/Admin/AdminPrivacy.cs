namespace Patika.Api.Features.Admin;

public static class AdminPrivacy
{
    public static string? MaskEmail(string? email)
    {
        if (string.IsNullOrEmpty(email)) return null;
        var at = email.IndexOf('@');
        if (at < 1 || at + 1 >= email.Length) return "***";
        var dot = email.LastIndexOf('.');
        return $"{email[0]}***@{email[at + 1]}***{(dot > at + 1 ? email[dot..] : "")}";
    }
}
