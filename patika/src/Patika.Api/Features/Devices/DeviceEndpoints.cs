using FluentValidation;
using Patika.Api.Security.Authorization;
using Patika.Api.Validation;
using Patika.Contracts.Errors;
using Patika.Contracts.Geo;
using Patika.Contracts.Urgent;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Domain.Security;

namespace Patika.Api.Features.Devices;

public static class DeviceRules
{
    public const int MinTokenLength = 32;
    public const int MaxTokenLength = 512;
    public const int MaxDevicesPerUser = 10;
    public const int MinRadiusMeters = 500;
    public const int MaxRadiusMeters = 2000;

    /// <summary>Saved areas are coarse: 3 decimals is roughly 110 m, never a precise position.</summary>
    public const int HomeAreaDecimals = 3;

    // FCM registration tokens are URL-safe base64 plus ':' separators.
    public static bool IsPushToken(string? token) =>
        token is { Length: >= MinTokenLength and <= MaxTokenLength }
        && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or ':');

    public static double Round(double value) => Math.Round(value, HomeAreaDecimals, MidpointRounding.AwayFromZero);
}

public sealed class RegisterDeviceRequestValidator : AbstractValidator<RegisterDeviceRequest>
{
    public RegisterDeviceRequestValidator()
    {
        RuleFor(r => r.Token).Must(DeviceRules.IsPushToken).WithMessage("Token is not a valid push registration token.");
        RuleFor(r => r.InstallationId).NotEqual(Guid.Empty).WithMessage("Installation id is required.");
        RuleFor(r => r.Environment)
            .Must(e => e is null || e is nameof(StoreEnvironment.Sandbox) or nameof(StoreEnvironment.Production))
            .WithMessage("Environment must be Sandbox or Production.");
    }
}

public sealed class UnregisterDeviceRequestValidator : AbstractValidator<UnregisterDeviceRequest>
{
    public UnregisterDeviceRequestValidator()
    {
        RuleFor(r => r.Token).Must(DeviceRules.IsPushToken).WithMessage("Token is not a valid push registration token.");
    }
}

public sealed class UrgentSettingsRequestValidator : AbstractValidator<UrgentSettingsRequest>
{
    public UrgentSettingsRequestValidator()
    {
        RuleFor(r => r.HomeArea).NotNull().When(r => r.OptIn).WithMessage("A home area is required to opt in.");
        RuleFor(r => r.HomeArea!).SetValidator(new CoordinateValidator()).When(r => r.HomeArea is not null);
        RuleFor(r => r.RadiusMeters)
            .InclusiveBetween(DeviceRules.MinRadiusMeters, DeviceRules.MaxRadiusMeters)
            .When(r => r.RadiusMeters is not null)
            .WithMessage("Radius must be between 500 and 2000 metres.");
    }
}

public static class DeviceEndpoints
{
    private const string ProblemJson = "application/problem+json";

    public static IServiceCollection AddDeviceServices(this IServiceCollection services)
    {
        services.AddScoped<IDeviceStore, EfDeviceStore>();
        return services;
    }

    public static RouteGroupBuilder MapDeviceEndpoints(this RouteGroupBuilder v1)
    {
        var me = v1.MapGroup("/me").WithTags("Devices").RequirePermission(Permission.MeManage);

        me.MapPut("/device-token", RegisterAsync)
            .Validate<RegisterDeviceRequest>()
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ApiProblemDetails>(StatusCodes.Status409Conflict, ProblemJson)
            .Produces<ApiProblemDetails>(StatusCodes.Status401Unauthorized, ProblemJson);

        // Always 204, whether or not the token existed or belonged to the caller: no ownership oracle.
        me.MapDelete("/device-token", UnregisterAsync)
            .Validate<UnregisterDeviceRequest>()
            .Produces(StatusCodes.Status204NoContent);

        me.MapGet("/urgent-settings", GetSettingsAsync)
            .Produces<UrgentSettingsResponse>();

        me.MapPut("/urgent-settings", PutSettingsAsync)
            .Validate<UrgentSettingsRequest>()
            .Produces<UrgentSettingsResponse>();

        return v1;
    }

    private static async Task<IResult> RegisterAsync(
        HttpContext http, RegisterDeviceRequest request, IDeviceStore store, TimeProvider clock, CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId)
        {
            return TypedResults.Unauthorized();
        }

        var environment = request.Environment == nameof(StoreEnvironment.Sandbox)
            ? StoreEnvironment.Sandbox
            : StoreEnvironment.Production;
        var outcome = await store.RegisterAsync(
            userId, request.InstallationId, request.Token, environment, clock.GetUtcNow(), DeviceRules.MaxDevicesPerUser, ct);
        if (outcome == DeviceRegistration.TokenInUse)
        {
            return TypedResults.Problem(title: "This push token belongs to another installation.",
                statusCode: StatusCodes.Status409Conflict,
                extensions: new Dictionary<string, object?> { ["code"] = UrgentErrorCodes.DeviceTokenInUse });
        }

        return TypedResults.NoContent();
    }

    private static async Task<IResult> UnregisterAsync(
        HttpContext http, [Microsoft.AspNetCore.Mvc.FromBody] UnregisterDeviceRequest request, IDeviceStore store,
        CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId)
        {
            return TypedResults.Unauthorized();
        }

        await store.UnregisterAsync(userId, request.Token, ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> GetSettingsAsync(HttpContext http, IDeviceStore store, CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId
            || await store.GetUrgentSettingsAsync(userId, ct) is not { } settings)
        {
            return TypedResults.Unauthorized();
        }

        return TypedResults.Ok(ToResponse(settings));
    }

    private static async Task<IResult> PutSettingsAsync(
        HttpContext http, UrgentSettingsRequest request, IDeviceStore store, CancellationToken ct)
    {
        if (ActorFactory.FromPrincipal(http.User).UserId is not { } userId
            || await store.GetUrgentSettingsAsync(userId, ct) is not { } current)
        {
            return TypedResults.Unauthorized();
        }

        // Opting out erases the saved area; nothing about where the volunteer lives is kept.
        GeoPoint? home = request.OptIn && request.HomeArea is { } area
            ? new GeoPoint(DeviceRules.Round(area.Longitude), DeviceRules.Round(area.Latitude))
            : null;
        var updated = new UrgentSettings(request.OptIn, home, request.RadiusMeters ?? current.RadiusMeters);
        await store.SetUrgentSettingsAsync(userId, updated, ct);
        return TypedResults.Ok(ToResponse(updated));
    }

    private static UrgentSettingsResponse ToResponse(UrgentSettings settings) => new(
        settings.OptIn,
        settings.HomeArea is { } home ? new CoordinateDto(home.Latitude, home.Longitude) : null,
        Math.Min(settings.RadiusMeters, DeviceRules.MaxRadiusMeters));
}
