using System.Globalization;
using System.Net.Mail;
using FluentValidation;

namespace Patika.Api.Validation;

public static class TextRules
{
    public const int MaxEmailLength = 254;

    /// <summary>Rejects control and invisible format characters (including bidi overrides).</summary>
    public static bool HasNoControlCharacters(string? value) =>
        value is null || value.All(c => CharUnicodeInfo.GetUnicodeCategory(c) is not
            (UnicodeCategory.Control or UnicodeCategory.Format or UnicodeCategory.LineSeparator
                or UnicodeCategory.ParagraphSeparator));

    public static bool IsEmailAddress(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaxEmailLength || value.Trim() != value)
        {
            return false;
        }

        try
        {
            var address = new MailAddress(value);
            var host = address.Host;
            return string.Equals(address.Address, value, StringComparison.Ordinal)
                && host.Contains('.', StringComparison.Ordinal)
                && !host.StartsWith('.') && !host.EndsWith('.')
                && HasNoControlCharacters(value);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    public static IRuleBuilderOptions<T, string> PatikaEmail<T>(this IRuleBuilder<T, string> rule) =>
        rule.NotEmpty().WithMessage("Email is required.")
            .MaximumLength(MaxEmailLength)
            .Must(IsEmailAddress).WithMessage("Email is not a valid address.");

    public static IRuleBuilderOptions<T, string> PlainText<T>(this IRuleBuilder<T, string> rule, int min, int max) =>
        rule.NotEmpty()
            .Must(value => value is null || value.Trim().Length >= min).WithMessage($"Must be at least {min} characters.")
            .MaximumLength(max)
            .Must(HasNoControlCharacters).WithMessage("Must not contain control characters.");
}
