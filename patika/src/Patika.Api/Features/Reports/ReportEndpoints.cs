using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Patika.Api.Features.Adoptions;
using Patika.Api.Security.Authorization;
using Patika.Api.Validation;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Reports;

public sealed record CreateReport(string TargetType, Guid TargetId, string Reason);
public sealed record ReportReceipt(Guid Id, string State);

public sealed class CreateReportValidator : AbstractValidator<CreateReport>
{
    public CreateReportValidator()
    {
        RuleFor(x => x.TargetType).Must(x => x is "station" or "animal" or "animal_photo" or "adoption" or "urgent" or "care_place");
        RuleFor(x => x.TargetId).NotEmpty();
        RuleFor(x => x.Reason).Must(x => AdoptionText.Clean(x).Length > 0).MaximumLength(2000);
    }
}

public static class ReportEndpoints
{
    public static RouteGroupBuilder MapReportEndpoints(this RouteGroupBuilder v1)
    {
        v1.MapPost("/reports", Create).Validate<CreateReport>().RequirePermission(Permission.ReportsCreate)
            .Produces<ReportReceipt>(201);
        return v1;
    }

    private static async Task<IResult> Create(CreateReport body, HttpContext http, PatikaDbContext db, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var exists = body.TargetType switch
        {
            "station" => await db.Stations.AnyAsync(x => x.Id == body.TargetId && x.Status != StationStatus.Removed, ct),
            "animal" => await db.Animals.AnyAsync(x => x.Id == body.TargetId, ct),
            "animal_photo" => await db.AnimalPhotos.AnyAsync(x => x.Id == body.TargetId && x.ModerationState == ModerationState.Approved, ct),
            "adoption" => await db.AdoptionPosts.AnyAsync(x => x.Id == body.TargetId && x.State == AdoptionPostState.Published && x.ClosesAt > now, ct),
            "urgent" => await db.UrgentPosts.AnyAsync(x => x.Id == body.TargetId && x.State == UrgentPostState.Open, ct),
            "care_place" => await db.CarePlaces.AnyAsync(x => x.Id == body.TargetId, ct),
            _ => false
        };
        if (!exists) return Results.NotFound();
        var report = new Report
        {
            TargetType = body.TargetType,
            TargetId = body.TargetId,
            ReporterId = ActorFactory.FromPrincipal(http.User).UserId!.Value,
            Reason = AdoptionText.Clean(body.Reason),
            State = ReportState.Pending
        };
        db.Reports.Add(report);
        await db.SaveChangesAsync(ct);
        return Results.Json(new ReportReceipt(report.Id, report.State.ToString()), statusCode: 201);
    }
}
