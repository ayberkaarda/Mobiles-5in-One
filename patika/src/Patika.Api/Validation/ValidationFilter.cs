using FluentValidation;
using Patika.Contracts.Auth;

namespace Patika.Api.Validation;

/// <summary>Runs the registered validator for the request DTO and returns RFC 9457 validation problems.</summary>
public sealed class ValidationFilter<T>(IValidator<T> validator) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var argument = context.Arguments.OfType<T>().FirstOrDefault();
        if (argument is null)
        {
            return ValidationProblem(new Dictionary<string, string[]> { ["body"] = ["A request body is required."] });
        }

        // Only human-readable fields; credentials, tokens, keys and identifiers remain byte-for-byte intact.
        foreach (var property in typeof(T).GetProperties().Where(p => p.PropertyType == typeof(string) && p.CanWrite
            && p.Name is "DisplayName" or "Name" or "Note" or "Description" or "Requirements" or "Message" or "Reply" or "Reason" or "District"))
        {
            if (property.GetValue(argument) is string text)
                property.SetValue(argument, Patika.Domain.UserText.Clean(text));
        }
        var result = await validator.ValidateAsync(argument, context.HttpContext.RequestAborted);
        if (result.IsValid)
        {
            return await next(context);
        }

        var errors = result.Errors
            .GroupBy(error => CamelCase(error.PropertyName), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Select(error => error.ErrorMessage).Distinct().ToArray(),
                StringComparer.Ordinal);
        return ValidationProblem(errors);
    }

    public static IResult ValidationProblem(IDictionary<string, string[]> errors, string code = AuthErrorCodes.ValidationFailed) =>
        TypedResults.ValidationProblem(
            errors,
            title: "One or more validation errors occurred.",
            extensions: new Dictionary<string, object?> { ["code"] = code });

    private static string CamelCase(string name) =>
        name is null or "" ? "body" : char.ToLowerInvariant(name[0]) + name[1..];
}

public static class ValidationExtensions
{
    public static RouteHandlerBuilder Validate<T>(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter<ValidationFilter<T>>().ProducesValidationProblem();
}
