using System.Collections;
using System.Collections.Concurrent;
using System.Reflection;
using Patika.Contracts;
using Patika.Domain;

namespace Patika.Api.Validation;

/// <summary>
/// Cleans every string of a request contract with <see cref="UserText.Clean"/>: string properties, string arrays and
/// lists, and nested contract objects or collections of them. Only properties marked <see cref="VerbatimAttribute"/>
/// (passwords, opaque tokens) are left as they are, so a new text field is cleaned without anyone remembering to.
/// </summary>
public static class RequestText
{
    private const int MaxDepth = 6;
    private static readonly Assembly Contracts = typeof(VerbatimAttribute).Assembly;
    private static readonly ConcurrentDictionary<Type, PropertyInfo[]> Plans = new();

    public static bool IsContract(Type type) => type.Assembly == Contracts && !type.IsEnum && !type.IsPrimitive;

    public static void Clean(object? value) => Clean(value, 0);

    /// <summary>The string-bearing properties of <paramref name="type"/> that are cleaned (public, writable, not verbatim).</summary>
    public static PropertyInfo[] CleanedProperties(Type type) => Plans.GetOrAdd(type, static t => [.. t
        .GetProperties(BindingFlags.Public | BindingFlags.Instance)
        .Where(p => p.CanRead && p.GetIndexParameters().Length == 0 && p.GetCustomAttribute<VerbatimAttribute>() is null)]);

    private static void Clean(object? value, int depth)
    {
        if (value is null || depth > MaxDepth || !IsContract(value.GetType()))
        {
            return;
        }

        foreach (var property in CleanedProperties(value.GetType()))
        {
            var current = property.GetValue(value);
            switch (current)
            {
                case string text when property.CanWrite:
                    var cleaned = UserText.Clean(text);
                    if (cleaned != text) property.SetValue(value, cleaned);
                    break;
                case string[] texts:
                    for (var i = 0; i < texts.Length; i++)
                    {
                        if (texts[i] is { } item) texts[i] = UserText.Clean(item);
                    }

                    break;
                case IList<string> list when !list.IsReadOnly:
                    for (var i = 0; i < list.Count; i++)
                    {
                        if (list[i] is { } item) list[i] = UserText.Clean(item);
                    }

                    break;
                case string:
                    break;
                case IEnumerable items:
                    foreach (var item in items)
                    {
                        Clean(item, depth + 1);
                    }

                    break;
                default:
                    Clean(current, depth + 1);
                    break;
            }
        }
    }
}

/// <summary>Runs <see cref="RequestText.Clean(object?)"/> on every request contract argument of the endpoints it is added to.</summary>
public sealed class RequestTextFilter : IEndpointFilter
{
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        // PostgreSQL text cannot hold U+0000: a NUL in a query or route value would reach the database and fail
        // there as a 500 (found by the ZAP API scan with district=%00). It is never valid input, so refuse it here.
        if (NulField(context.HttpContext.Request) is { } field)
        {
            return ValueTask.FromResult<object?>(ValidationFilter<object>.ValidationProblem(
                new Dictionary<string, string[]> { [field] = ["The value must not contain a NUL character."] }));
        }

        foreach (var argument in context.Arguments)
        {
            RequestText.Clean(argument);
        }

        return next(context);
    }

    private static string? NulField(HttpRequest request)
    {
        foreach (var (key, values) in request.Query)
        {
            if (key.Contains('\0', StringComparison.Ordinal) || values.Any(value => value?.Contains('\0', StringComparison.Ordinal) == true))
            {
                return key.Contains('\0', StringComparison.Ordinal) ? "query" : key;
            }
        }

        foreach (var (key, value) in request.RouteValues)
        {
            if (value is string text && text.Contains('\0', StringComparison.Ordinal))
            {
                return key;
            }
        }

        return null;
    }
}
