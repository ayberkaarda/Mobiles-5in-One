using System.Globalization;
using System.Text;

namespace Patika.Domain;

/// <summary>Server-side cleanup of human-readable text before it is validated or stored.</summary>
public static class UserText
{
    private static readonly Rune ZeroWidthJoiner = new(0x200D);
    private static readonly Rune ZeroWidthNonJoiner = new(0x200C);

    /// <summary>
    /// Works on Unicode scalar values (<see cref="string.EnumerateRunes"/>), so supplementary characters are classified
    /// whole: removes control and invisible format characters (bidi overrides and isolates, zero-width spaces, BOM,
    /// C0/C1 controls, the U+E0000 tag block). Line breaks, tabs and Unicode line/paragraph separators become a single
    /// space so words on either side stay apart; every field is rendered as one line. ZERO WIDTH JOINER and NON-JOINER
    /// stay where they join two visible characters (emoji sequences, Persian and Indic scripts), never at the edges
    /// or in a run, so they cannot make a field look empty. A lone surrogate becomes U+FFFD.
    /// </summary>
    public static string Clean(string value)
    {
        var builder = new StringBuilder(value.Length);
        var pendingJoiner = (Rune?)null;
        Span<char> utf16 = stackalloc char[2];
        foreach (var rune in value.EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (rune.Value is '\t' or '\n' or '\r' || category is UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
            {
                pendingJoiner = null;
                if (builder.Length > 0 && builder[^1] != ' ') builder.Append(' ');
            }
            else if (rune == ZeroWidthJoiner || rune == ZeroWidthNonJoiner)
            {
                // Kept only when something visible came before; written once the next visible character arrives.
                pendingJoiner = builder.Length > 0 && builder[^1] != ' ' ? rune : null;
            }
            else if (category is not (UnicodeCategory.Control or UnicodeCategory.Format))
            {
                if (pendingJoiner is { } joiner && !Rune.IsWhiteSpace(rune)) builder.Append((char)joiner.Value);
                pendingJoiner = null;
                builder.Append(utf16[..rune.EncodeToUtf16(utf16)]);
            }
        }

        return builder.ToString();
    }
}
