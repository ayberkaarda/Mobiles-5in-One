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
public static class MarkdownLite
{
    public static Microsoft.AspNetCore.Html.IHtmlContent InlineContent(string text) =>
        new Microsoft.AspNetCore.Html.HtmlString(Inline(text));

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

            var heading = HeadingPatternRegex.Match(line);
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

            var item = ListPatternRegex.Match(line);
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
        var text = LinkPatternRegex.Replace(markdown, "${text}");
        text = text.Replace("**", "", StringComparison.Ordinal);
        text = LineMarkerPatternRegex.Replace(text, "");
        return WhitespacePatternRegex.Replace(text, " ").Trim();
    }

    public static int CountWords(string text) => WordPatternRegex.Count(text);

    public static string Inline(string text)
    {
        var encoded = Encode(text);
        encoded = LinkPatternRegex.Replace(encoded, match =>
        {
            var href = WebUtility.HtmlDecode(match.Groups["href"].Value);
            var label = match.Groups["text"].Value;
            if (!IsAllowedHref(href)) return label;
            var external = href.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
            return $"<a href=\"{Encode(href)}\"{(external ? " rel=\"noopener\"" : "")}>{label}</a>";
        });
        encoded = BoldPatternRegex.Replace(encoded, "<strong>${text}</strong>");
        encoded = PlaceholderPatternRegex.Replace(encoded, "<mark class=\"doc-ph\">${text}</mark>");
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

    private static readonly Regex HeadingPatternRegex = new(@"^(?<hashes>#{2,3})\s+(?<text>.+?)(\s*\{#(?<id>[a-z0-9-]+)\})?$", RegexOptions.Compiled);

    private static readonly Regex ListPatternRegex = new(@"^(?:(?<ordered>\d+\.)|[-*])\s+(?<text>.+)$", RegexOptions.Compiled);

    private static readonly Regex LinkPatternRegex = new(@"\[(?<text>[^\]]+)\]\((?<href>[^)\s]+)\)", RegexOptions.Compiled);

    private static readonly Regex BoldPatternRegex = new(@"\*\*(?<text>.+?)\*\*", RegexOptions.Compiled);

    private static readonly Regex PlaceholderPatternRegex = new(@"(?<text>\[[A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9 ,;:./()&-]{2,}\])", RegexOptions.Compiled);

    private static readonly Regex LineMarkerPatternRegex = new(@"(?m)^\s*(?:#{1,6}|\d+\.|[-*])\s+", RegexOptions.Compiled);

    private static readonly Regex WhitespacePatternRegex = new(@"\s+", RegexOptions.Compiled);

    private static readonly Regex WordPatternRegex = new(@"[\p{L}\p{N}][\p{L}\p{N}'’.-]*", RegexOptions.Compiled);
}
