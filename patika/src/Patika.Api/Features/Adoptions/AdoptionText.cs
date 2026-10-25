using System.Globalization;

namespace Patika.Api.Features.Adoptions;

public static class AdoptionText
{
    public static string Clean(string? value) => string.Concat((value ?? "").Where(c =>
        CharUnicodeInfo.GetUnicodeCategory(c) is not (UnicodeCategory.Control or UnicodeCategory.Format
            or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator))).Trim();
}
