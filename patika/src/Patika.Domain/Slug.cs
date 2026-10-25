using System.Text;

namespace Patika.Domain;

public static class Slug
{
    public static string From(string value)
    {
        var result = new StringBuilder();
        // Composed form first, so a decomposed "o" + U+0308 folds like "ö".
        foreach (var character in value.Normalize(NormalizationForm.FormC))
        {
            var folded = character switch
            {
                'ı' or 'İ' or 'î' or 'Î' => 'i',
                'â' or 'Â' => 'a',
                'û' or 'Û' => 'u',
                'ş' or 'Ş' => 's',
                'ğ' or 'Ğ' => 'g',
                'ü' or 'Ü' => 'u',
                'ö' or 'Ö' => 'o',
                'ç' or 'Ç' => 'c',
                _ => char.ToLowerInvariant(character)
            };
            if (folded is >= 'a' and <= 'z' or >= '0' and <= '9') result.Append(folded);
            else if (result.Length > 0 && result[^1] != '-') result.Append('-');
        }
        var slug = result.ToString().Trim('-');
        return slug.Length == 0 ? "x" : slug[..Math.Min(80, slug.Length)].TrimEnd('-');
    }
}
