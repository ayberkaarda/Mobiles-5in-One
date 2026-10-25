using System.Text.RegularExpressions;
using Serilog.Core;
using Serilog.Events;

namespace Patika.Api.Logging;

/// <summary>
/// Last enricher in the pipeline: masks email addresses (<c>a***@d***</c>), drops credential-bearing
/// properties (tokens, passwords, Authorization, Cookie), replaces JWT-shaped strings and rounds
/// coordinates to three decimal places, recursively through structured values.
/// </summary>
public sealed class MaskingEnricher : ILogEventEnricher
{
    public const string Redacted = "[redacted]";

    private const RegexOptions PatternOptions = RegexOptions.CultureInvariant | RegexOptions.Compiled;

    private static readonly Regex EmailRegex = new(@"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", PatternOptions);

    private static readonly Regex JwtRegex = new(@"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*", PatternOptions);

    private static readonly Regex CoordinatePairRegex =
        new(@"(?<a>-?\d{1,3}\.\d{4,}),(?<sep>\s?)(?<b>-?\d{1,3}\.\d{4,})", PatternOptions);

    private static readonly string[] SensitiveNameParts =
    [
        "password", "token", "authorization", "cookie", "secret", "credential", "apikey", "signingkey",
    ];

    private static readonly string[] CoordinateNames = ["lat", "lng", "lon", "latitude", "longitude"];

    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        foreach (var property in logEvent.Properties.ToArray())
        {
            if (IsSensitiveName(property.Key))
            {
                logEvent.AddOrUpdateProperty(new LogEventProperty(property.Key, new ScalarValue(Redacted)));
                continue;
            }

            var masked = Mask(property.Key, property.Value);
            if (!ReferenceEquals(masked, property.Value))
            {
                logEvent.AddOrUpdateProperty(new LogEventProperty(property.Key, masked));
            }
        }
    }

    public static string MaskEmail(string email)
    {
        var at = email.IndexOf('@', StringComparison.Ordinal);
        if (at <= 0 || at == email.Length - 1)
        {
            return Redacted;
        }

        return $"{email[0]}***@{email[at + 1]}***";
    }

    public static string MaskText(string value)
    {
        var result = JwtPattern().Replace(value, Redacted);
        result = EmailPattern().Replace(result, match => MaskEmail(match.Value));
        result = CoordinatePairPattern().Replace(result, match =>
            $"{Round(match.Groups["a"].Value)},{match.Groups["sep"].Value}{Round(match.Groups["b"].Value)}");
        return result;
    }

    private static bool IsSensitiveName(string name)
    {
        foreach (var part in SensitiveNameParts)
        {
            if (name.Contains(part, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static LogEventPropertyValue Mask(string name, LogEventPropertyValue value)
    {
        switch (value)
        {
            case ScalarValue { Value: string text }:
                var masked = MaskText(text);
                return masked == text ? value : new ScalarValue(masked);
            case ScalarValue { Value: double number } when IsCoordinateName(name):
                return new ScalarValue(Math.Round(number, 3));
            case ScalarValue { Value: decimal number } when IsCoordinateName(name):
                return new ScalarValue(Math.Round(number, 3));
            case StructureValue structure:
                return new StructureValue(
                    structure.Properties.Select(p => IsSensitiveName(p.Name)
                        ? new LogEventProperty(p.Name, new ScalarValue(Redacted))
                        : new LogEventProperty(p.Name, Mask(p.Name, p.Value))),
                    structure.TypeTag);
            case SequenceValue sequence:
                return new SequenceValue(sequence.Elements.Select(e => Mask(name, e)));
            case DictionaryValue dictionary:
                return new DictionaryValue(dictionary.Elements.Select(pair =>
                {
                    var key = pair.Key.Value?.ToString() ?? string.Empty;
                    return new KeyValuePair<ScalarValue, LogEventPropertyValue>(
                        pair.Key, IsSensitiveName(key) ? new ScalarValue(Redacted) : Mask(key, pair.Value));
                }));
            default:
                return value;
        }
    }

    private static bool IsCoordinateName(string name) =>
        CoordinateNames.Any(candidate => string.Equals(candidate, name, StringComparison.OrdinalIgnoreCase));

    private static string Round(string number) =>
        double.TryParse(number, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? Math.Round(value, 3).ToString("0.000", System.Globalization.CultureInfo.InvariantCulture)
            : number;

    private static Regex EmailPattern() => EmailRegex;

    private static Regex JwtPattern() => JwtRegex;

    private static Regex CoordinatePairPattern() => CoordinatePairRegex;
}
