using System.Globalization;
using System.Text;

namespace Patika.Domain;

/// <summary>Server-side cleanup of human-readable text before it is validated or stored.</summary>
public static class UserText
{
    /// <summary>
    /// Removes control and invisible format characters (bidi overrides and isolates, zero-width marks, C0/C1
    /// controls). Line breaks, tabs and Unicode line/paragraph separators become a single space so words on
    /// either side stay apart; every field is rendered as one line.
    /// </summary>
    public static string Clean(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var c in value)
        {
            var category = char.GetUnicodeCategory(c);
            if (c is '\t' or '\n' or '\r' || category is UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
            {
                if (builder.Length > 0 && builder[^1] != ' ') builder.Append(' ');
            }
            else if (category is not (UnicodeCategory.Control or UnicodeCategory.Format))
            {
                builder.Append(c);
            }
        }

        return builder.ToString();
    }
}
