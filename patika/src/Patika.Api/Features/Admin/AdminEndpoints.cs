using Patika.Api.Features.Auth;
using Patika.Api.Security.Authorization;
using Patika.Api.Security.RateLimiting;
using Patika.Api.Validation;
using Patika.Contracts.Admin;

namespace Patika.Api.Features.Admin;

public static class AdminEndpoints
{
    public static IEndpointRouteBuilder MapAdmin(this IEndpointRouteBuilder endpoints)
    {
        var admin = endpoints.MapGroup("/admin").RequireAuthorization(AdminPolicies.Moderate).WithTags("Admin");
        admin.MapGet("/queue", (string? type, string? cursor, AdminHandlers h, CancellationToken ct) => h.QueueAsync(type, cursor, ct));
        admin.MapPost("/decisions", (HttpContext http, AdminDecisionRequest request, AdminHandlers h, CancellationToken ct) => h.DecideAsync(http, request, ct)).Validate<AdminDecisionRequest>();
        admin.MapPost("/step-up", (HttpContext http, StepUpRequest request, TotpService service, CancellationToken ct) => service.StepUpAsync(http.User, request, ct))
            .RequireRateLimiting(RateLimitPolicies.Totp).Validate<StepUpRequest>();
        admin.MapGet("/users", (string? q, AdminHandlers h, CancellationToken ct) => h.UsersAsync(q, ct)).RequireAuthorization(AdminPolicies.Manage);
        admin.MapPost("/users/{id:guid}/role", (Guid id, HttpContext http, AdminRoleRequest request, AdminHandlers h, CancellationToken ct) => h.RoleAsync(http, id, request, ct))
            .RequireAuthorization(AdminPolicies.Manage).Validate<AdminRoleRequest>();
        admin.MapPost("/users/{id:guid}/suspend", (Guid id, HttpContext http, AdminSuspendRequest request, AdminHandlers h, CancellationToken ct) => h.SuspendAsync(http, id, request, ct))
            .RequireAuthorization(AdminPolicies.Manage).Validate<AdminSuspendRequest>();
        admin.MapPost("/users/{id:guid}/unsuspend", (Guid id, HttpContext http, AdminUnsuspendRequest request, AdminHandlers h, CancellationToken ct) => h.UnsuspendAsync(http, id, request, ct))
            .RequireAuthorization(AdminPolicies.Manage).Validate<AdminUnsuspendRequest>();
        admin.MapGet("/audit", (Guid? actor, string? action, string? target, DateTimeOffset? from, DateTimeOffset? to, string? cursor, AdminHandlers h, CancellationToken ct) =>
            h.AuditAsync(actor, action, target, from, to, cursor, ct)).RequireAuthorization(AdminPolicies.Manage);
        admin.MapPost("/care-places/csv/preview", (HttpContext http, AdminHandlers h, CancellationToken ct) => h.CsvAsync(http, false, ct))
            .RequireAuthorization(AdminPolicies.Manage);
        admin.MapPost("/care-places/csv/commit", (HttpContext http, AdminHandlers h, CancellationToken ct) => h.CsvAsync(http, true, ct))
            .RequireAuthorization(AdminPolicies.Manage);
        return endpoints;
    }
}
