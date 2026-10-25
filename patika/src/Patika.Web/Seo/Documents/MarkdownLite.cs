using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Patika.Domain;

namespace Patika.Web.Seo.Documents;

public sealed record DocHeading(int Level, string Id, string Text);

/// <summary>
/// The small Markdown subset the site's own content uses: <c>##</c>/<c>###</c> headings (optional
/// <c>{#id}</c>), paragraphs, <c>-</c> and <c>1.</c> lists, <c>**bold**</c> and <c>[text](href)</c>.
/// Every character of the source is HTML-encoded first; only the tags written here are produced, and
/// links are kept only for site paths, fragments, https and mailto. Upper-case <c>[YER TUTUCU]</c>
/// placeholders are marked so they stay visible until legal review fills them.
/// </summary>
public static partial class MarkdownLite
{
    public static (string Html, IReadOnlyList<DocHeading> Headings) Render(string markdown)
    {
        var html = new StringBuilder();
        var headings = new List<DocHeading>();
        var paragraph = new List<string>();
        string? listTag = null;

        void FlushParagraph()
        {
            if (paragraph.Count == 0) return;
            html.Append("<p>").Append(Inline(string.Join(' ', paragraph))).Append("</p>\n");
            paragraph.Clear();
        }

        void CloseList()
        {
            if (listTag is null) return;
            html.Append("</").Append(listTag).Append(">\n");
            listTag = null;
        }

        foreach (var raw in markdown.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n'))
        {
            var line = raw.TrimEnd();
            if (line.Length == 0)
            {
                FlushParagraph();
                CloseList();
                continue;
            }

            var heading = HeadingPattern().Match(line);
            if (heading.Success)
            {
                FlushParagraph();
                CloseList();
                var level = heading.Groups["hashes"].Length;
                var text = heading.Groups["text"].Value.Trim();
                var id = heading.Groups["id"].Success ? heading.Groups["id"].Value : Slug.From(text);
                headings.Add(new DocHeading(level, id, text));
                html.Append("<h").Append(level).Append(" id=\"").Append(Encode(id)).Append("\">")
                    .Append(Inline(text)).Append("</h").Append(level).Append(">\n");
                continue;
            }

            var item = ListPattern().Match(line);
            if (item.Success)
            {
                FlushParagraph();
                var tag = item.Groups["ordered"].Success ? "ol" : "ul";
                if (listTag != tag)
                {
                    CloseList();
                    html.Append('<').Append(tag).Append(">\n");
                    listTag = tag;
                }
                html.Append("<li>").Append(Inline(item.Groups["text"].Value.Trim())).Append("</li>\n");
                continue;
            }

            CloseList();
            paragraph.Add(line.Trim());
        }

        FlushParagraph();
        CloseList();
        return (html.ToString(), headings);
    }

    /// <summary>Plain text of a Markdown fragment (for word counts and JSON-LD answers).</summary>
    public static string PlainText(string markdown)
    {
        var text = LinkPattern().Replace(markdown, "${text}");
        text = text.Replace("**", "", StringComparison.Ordinal);
        text = LineMarkerPattern().Replace(text, "");
        return WhitespacePattern().Replace(text, " ").Trim();
    }

    public static int CountWords(string text) => WordPattern().Count(text);

    public static string Inline(string text)
    {
        var encoded = Encode(text);
        encoded = LinkPattern().Replace(encoded, match =>
        {
            var href = WebUtility.HtmlDecode(match.Groups["href"].Value);
            var label = match.Groups["text"].Value;
            if (!IsAllowedHref(href)) return label;
            var external = href.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
            return $"<a href=\"{Encode(href)}\"{(external ? " rel=\"noopener\"" : "")}>{label}</a>";
        });
        encoded = BoldPattern().Replace(encoded, "<strong>${text}</strong>");
        encoded = PlaceholderPattern().Replace(encoded, "<mark class=\"doc-ph\">${text}</mark>");
        return encoded;
    }

    /// <summary>Encodes the five HTML-significant characters; Turkish letters stay as they are.</summary>
    public static string Encode(string value) => value
        .Replace("&", "&amp;", StringComparison.Ordinal)
        .Replace("<", "&lt;", StringComparison.Ordinal)
        .Replace(">", "&gt;", StringComparison.Ordinal)
        .Replace("\"", "&quot;", StringComparison.Ordinal)
        .Replace("'", "&#39;", StringComparison.Ordinal);

    private static bool IsAllowedHref(string href) =>
        (href.StartsWith('/') && !href.StartsWith("//", StringComparison.Ordinal))
        || href.StartsWith('#')
        || href.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
        || href.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase);

    [GeneratedRegex(@"^(?<hashes>#{2,3})\s+(?<text>.+?)(\s*\{#(?<id>[a-z0-9-]+)\})?$")]
    private static partial Regex HeadingPattern();

    [GeneratedRegex(@"^(?:(?<ordered>\d+\.)|[-*])\s+(?<text>.+)$")]
    private static partial Regex ListPattern();

    [GeneratedRegex(@"\[(?<text>[^\]]+)\]\((?<href>[^)\s]+)\)")]
    private static partial Regex LinkPattern();

    [GeneratedRegex(@"\*\*(?<text>.+?)\*\*")]
    private static partial Regex BoldPattern();

    [GeneratedRegex(@"(?<text>\[[A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9 ,;:./()&-]{2,}\])")]
    private static partial Regex PlaceholderPattern();

    [GeneratedRegex(@"(?m)^\s*(?:#{1,6}|\d+\.|[-*])\s+")]
    private static partial Regex LineMarkerPattern();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespacePattern();

    [GeneratedRegex(@"[\p{L}\p{N}][\p{L}\p{N}'’.-]*")]
    private static partial Regex WordPattern();
}
