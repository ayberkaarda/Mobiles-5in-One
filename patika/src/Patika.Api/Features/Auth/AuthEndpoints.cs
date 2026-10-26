using Patika.Api.Security.Authorization;
using Patika.Api.Security.RateLimiting;
using Patika.Api.Validation;
using Patika.Contracts.Auth;
using Patika.Contracts.Errors;
using Patika.Domain.Security;

namespace Patika.Api.Features.Auth;

public static class AuthEndpoints
{
    private const string ProblemJson = "application/problem+json";

    public static IEndpointRouteBuilder MapAuth(this IEndpointRouteBuilder endpoints)
    {
        var auth = endpoints.MapGroup("/auth").WithTags("Auth");

        auth.MapPost("/register", (HttpContext http, RegisterRequest request, AuthHandlers handlers, CancellationToken ct) =>
                handlers.RegisterAsync(http, request, ct))
            .Validate<RegisterRequest>()
            .RequirePermission(Permission.AuthSession)
            .RequireRateLimiting(RateLimitPolicies.Auth)
            .Produces<RegisterAcceptedResponse>(StatusCodes.Status202Accepted)
            .Produces<ApiProblemDetails>(StatusCodes.Status503ServiceUnavailable, ProblemJson);

        auth.MapPost("/verify-email", (VerifyEmailRequest request, AuthHandlers handlers, CancellationToken ct) =>
                handlers.VerifyEmailAsync(request, ct))
            .Validate<VerifyEmailRequest>()
            .RequirePermission(Permission.AuthSession)
            .RequireRateLimiting(RateLimitPolicies.Verify)
            .Produces<TokenResponse>()
            .Produces<ApiProblemDetails>(StatusCodes.Status400BadRequest, ProblemJson);

        auth.MapPost("/verify-email/resend", (HttpContext http, ResendVerificationRequest request, AuthHandlers handlers, CancellationToken ct) =>
                handlers.ResendVerificationAsync(http, request, ct))
            .Validate<ResendVerificationRequest>()
            .RequirePermission(Permission.AuthSession)
            .RequireRateLimiting(RateLimitPolicies.Auth)
            .Produces<RegisterAcceptedResponse>(StatusCodes.Status202Accepted)
            .Produces<ApiProblemDetails>(StatusCodes.Status429TooManyRequests, ProblemJson)
            .Produces<ApiProblemDetails>(StatusCodes.Status503ServiceUnavailable, ProblemJson);

        auth.MapPost("/forgot", (HttpContext http, ForgotPasswordRequest request, AuthHandlers handlers, CancellationToken ct) =>
                handlers.ForgotPasswordAsync(http, request, ct))
            .Validate<ForgotPasswordRequest>()
            .RequirePermission(Permission.AuthSession)
            .RequireRateLimiting(RateLimitPolicies.Auth)
            .Produces<ForgotPasswordAcceptedResponse>(StatusCodes.Status202Accepted)
            .Produces<ApiProblemDetails>(StatusCodes.Status503ServiceUnavailable, ProblemJson);

        auth.MapPost("/reset", (ResetPasswordRequest request, AuthHandlers handlers, CancellationToken ct) =>
                handlers.ResetPasswordAsync(request, ct))
            .Validate<ResetPasswordRequest>()
            .RequirePermission(Permission.AuthSession)
            .RequireRateLimiting(RateLimitPolicies.Verify)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ApiProblemDetails>(StatusCodes.Status400BadRequest, ProblemJson);

        auth.MapPost("/login", (HttpContext http, LoginRequest request, AuthHandlers handlers, CancellationToken ct) =>
                handlers.LoginAsync(http, request, ct))
            .Validate<LoginRequest>()
            .RequirePermission(Permission.AuthSession)
            .RequireRateLimiting(RateLimitPolicies.Auth)
            .Produces<TokenResponse>()
            .Produces<MfaRequiredResponse>(StatusCodes.Status202Accepted)
            .Produces<ApiProblemDetails>(StatusCodes.Status401Unauthorized, ProblemJson);

        auth.MapPost("/google", (GoogleSignInRequest request, AuthHandlers handlers, CancellationToken ct) =>
                handlers.ExternalAsync(GoogleIdTokenVerifier.ProviderName, request.IdToken, ct))
            .Validate<GoogleSignInRequest>()
            .RequirePermission(Permission.AuthSession)
            .RequireRateLimiting(RateLimitPolicies.External)
            .Produces<TokenResponse>()
            .Produces<MfaRequiredResponse>(StatusCodes.Status202Accepted)
            .Produces<ApiProblemDetails>(StatusCodes.Status401Unauthorized, ProblemJson)
            .Produces<ApiProblemDetails>(StatusCodes.Status409Conflict, ProblemJson);

        auth.MapPost("/refresh", (HttpContext http, RefreshRequest request, AuthHandlers handlers, CancellationToken ct) =>
                handlers.RefreshAsync(http, request, ct))
            .Validate<RefreshRequest>()
            .RequirePermission(Permission.AuthSession)
            .Produces<TokenResponse>()
            .Produces<ApiProblemDetails>(StatusCodes.Status401Unauthorized, ProblemJson);

        auth.MapPost("/logout", (LogoutRequest request, AuthHandlers handlers, CancellationToken ct) =>
                handlers.LogoutAsync(request, ct))
            .Validate<LogoutRequest>()
            .RequirePermission(Permission.AuthSession)
            .Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }
}
