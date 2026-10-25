using System.Globalization;
using System.Reflection;

namespace Patika.Web.Seo.Documents;

public sealed record FaqItem(string Question, string Answer);

/// <summary>One Markdown page from <c>Content/</c>: guide (<c>rehber</c>), legal (<c>yasal</c>) or site page (<c>sayfa</c>).</summary>
public sealed record ContentDoc(
    string Collection, string Slug, string Title, string Description, DateOnly Updated, DateOnly Published,
    string? Answer, string? ShortTitle, IReadOnlyList<FaqItem> Faq, IReadOnlyList<DocHeading> Headings, string Html, int WordCount)
{
    /// <summary>Reading time at about 180 words a minute, at least one minute.</summary>
    public int ReadingMinutes => Math.Max(1, (int)Math.Round(WordCount / 180.0));
}

/// <summary>
/// Loads every <c>Content/**/*.md</c> file (embedded in the assembly) once at startup. Each file starts
/// with front matter: <c>title</c>, <c>description</c>, <c>slug</c>, <c>updated</c> (yyyy-MM-dd), optional
/// <c>published</c>, <c>answer</c>, <c>short</c> and a <c>faq</c> list of <c>- q:</c>/<c>a:</c> pairs.
/// </summary>
public sealed class DocumentStore
{
    public const string ResourcePrefix = "patika-content:";
    private readonly Dictionary<(string, string), ContentDoc> docs = [];

    public DocumentStore() : this(typeof(DocumentStore).Assembly)
    {
    }

    internal DocumentStore(Assembly assembly)
    {
        foreach (var name in assembly.GetManifestResourceNames().Where(n => n.StartsWith(ResourcePrefix, StringComparison.Ordinal)))
        {
            var path = name[ResourcePrefix.Length..].Replace('\\', '/');
            var collection = path.Contains('/', StringComparison.Ordinal) ? path[..path.IndexOf('/', StringComparison.Ordinal)] : "";
            using var stream = assembly.GetManifestResourceStream(name)!;
            using var reader = new StreamReader(stream);
            var doc = Parse(collection, reader.ReadToEnd(), path);
            docs.Add((collection, doc.Slug), doc);
        }
    }

    public ContentDoc? Find(string collection, string slug) => docs.GetValueOrDefault((collection, slug));

    public IReadOnlyList<ContentDoc> List(string collection) =>
        docs.Values.Where(d => d.Collection == collection).OrderBy(d => d.Title, StringComparer.Create(CultureInfo.GetCultureInfo("tr-TR"), false)).ToArray();

    public static ContentDoc Parse(string collection, string source, string origin)
    {
        var text = source.Replace("\r\n", "\n", StringComparison.Ordinal);
        if (!text.StartsWith("---\n", StringComparison.Ordinal)) throw new FormatException($"{origin}: front matter missing.");
        var end = text.IndexOf("\n---\n", 4, StringComparison.Ordinal);
        if (end < 0) throw new FormatException($"{origin}: front matter not closed.");
        var (fields, faq) = ParseFrontMatter(text[4..end], origin);
        var body = text[(end + 5)..];
        var (html, headings) = MarkdownLite.Render(body);

        string Required(string key) => fields.TryGetValue(key, out var value) && value.Length > 0
            ? value : throw new FormatException($"{origin}: '{key}' missing.");
        DateOnly Date(string value) => DateOnly.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture);

        var updated = Date(Required("updated"));
        var answer = fields.GetValueOrDefault("answer");
        var words = MarkdownLite.CountWords(MarkdownLite.PlainText(body)) + (answer is null ? 0 : MarkdownLite.CountWords(answer));
        return new ContentDoc(collection, Required("slug"), Required("title"), Required("description"), updated,
            fields.TryGetValue("published", out var published) ? Date(published) : updated,
            answer, fields.GetValueOrDefault("short"), faq, headings, html, words);
    }

    private static (Dictionary<string, string> Fields, List<FaqItem> Faq) ParseFrontMatter(string block, string origin)
    {
        var fields = new Dictionary<string, string>(StringComparer.Ordinal);
        var faq = new List<FaqItem>();
        string? question = null;
        var inFaq = false;
        foreach (var raw in block.Split('\n'))
        {
            if (raw.Trim().Length == 0) continue;
            var line = raw.TrimEnd();
            if (inFaq && line.StartsWith(' '))
            {
                var entry = line.Trim();
                if (entry.StartsWith("- q:", StringComparison.Ordinal)) question = Value(entry[4..]);
                else if (entry.StartsWith("a:", StringComparison.Ordinal) && question is not null)
                {
                    faq.Add(new FaqItem(question, Value(entry[2..])));
                    question = null;
                }
                else throw new FormatException($"{origin}: unexpected faq line '{entry}'.");
                continue;
            }

            inFaq = false;
            var colon = line.IndexOf(':', StringComparison.Ordinal);
            if (colon <= 0) throw new FormatException($"{origin}: bad front matter line '{line}'.");
            var key = line[..colon].Trim();
            var value = Value(line[(colon + 1)..]);
            if (key == "faq" && value.Length == 0) inFaq = true;
            else fields[key] = value;
        }

        if (question is not null) throw new FormatException($"{origin}: faq question without answer.");
        return (fields, faq);
    }

    private static string Value(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length >= 2 && trimmed[0] == '"' && trimmed[^1] == '"' ? trimmed[1..^1].Replace("\\\"", "\"", StringComparison.Ordinal) : trimmed;
    }
}
