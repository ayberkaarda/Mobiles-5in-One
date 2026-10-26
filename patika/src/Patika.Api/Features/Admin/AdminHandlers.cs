using System.Globalization;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Patika.Api.Features.Auth;
using Patika.Api.Features.CarePlaces;
using Patika.Api.Security.Tokens;
using Patika.Contracts.Admin;
using Patika.Domain.Entities;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Admin;

public sealed class AdminHandlers(PatikaDbContext db, TotpService totp, EmailCodeHasher hashes,
    AdminPhotoUrls photos, TimeProvider clock)
{
    public async Task<IResult> QueueAsync(string? type, string? cursor, CancellationToken ct)
    {
        if (!AdminCursor.TryParse(cursor, out var after)) return Error(400, "cursor_invalid");
        var since = clock.GetUtcNow().AddDays(-30);
        IQueryable<QueueRow>? query = type switch
        {
            "adoption" => db.AdoptionPosts.Where(p => p.State == AdoptionPostState.Pending)
                .Select(p => new QueueRow
                {
                    Id = p.Id,
                    CreatedAt = p.CreatedAt,
                    AuthorId = p.CreatedBy,
                    Content = p.Description,
                    State = p.State.ToString(),
                    PhotoKey = db.AnimalPhotos.Where(photo => photo.AnimalId == p.AnimalId && photo.ModerationState != ModerationState.Rejected)
                        .OrderBy(photo => photo.CreatedAt).ThenBy(photo => photo.Id).Select(photo => photo.Key).FirstOrDefault(),
                }),
            // Deliberate management view: the public query filter must not hide the restore queue.
            "urgent" => db.UrgentPosts.IgnoreQueryFilters().Where(p => p.CreatedAt >= since)
                .Select(p => new QueueRow { Id = p.Id, CreatedAt = p.CreatedAt, AuthorId = p.CreatedBy, Content = p.Description, State = p.State.ToString(), Hidden = p.HiddenAt != null, PhotoKey = p.PhotoKey }),
            "photo" => db.AnimalPhotos.Where(p => p.ModerationState == ModerationState.Pending)
                .Select(p => new QueueRow { Id = p.Id, CreatedAt = p.CreatedAt, AuthorId = p.CreatedBy, Content = "", State = p.ModerationState.ToString(), PhotoKey = p.Key }),
            "report" => db.Reports.Where(p => p.State == ReportState.Pending)
                .Select(p => new QueueRow { Id = p.Id, CreatedAt = p.CreatedAt, AuthorId = p.ReporterId, Content = p.Reason, State = p.State.ToString() }),
            _ => null,
        };
        if (query is null) return Error(400, "queue_type_invalid");
        if (after is not null) query = query.Where(p => p.CreatedAt < after.At || (p.CreatedAt == after.At && p.Id.CompareTo(after.Id) < 0));
        var rows = await query.AsNoTracking().OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.Id).Take(26).ToListAsync(ct);
        var items = new List<AdminQueueItem>();
        foreach (var row in rows.Take(25))
        {
            var joined = await db.Users.Where(u => u.Id == row.AuthorId).Select(u => (DateTimeOffset?)u.CreatedAt).SingleOrDefaultAsync(ct);
            var author = joined is null ? null : new AdminAuthor(
                Convert.ToHexString(hashes.Hash(row.AuthorId, "admin_author", ""))[..12],
                Math.Max(0, (int)(clock.GetUtcNow() - joined.Value).TotalDays), await RejectionsAsync(row.AuthorId, ct));
            var url = row.PhotoKey is null ? null : await photos.ResolveAsync(db, row.PhotoKey, ct);
            items.Add(new AdminQueueItem(row.Id, type!, row.Content, row.State, row.Hidden, url, row.CreatedAt, author));
        }
        return Results.Ok(new AdminPage<AdminQueueItem>(items, rows.Count > 25 ? AdminCursor.Encode(rows[24].CreatedAt, rows[24].Id) : null));
    }

    public async Task<IResult> DecideAsync(HttpContext http, AdminDecisionRequest request, CancellationToken ct)
    {
        if (!Enum.TryParse<ModerationDecisionKind>(request.Decision, out var decision) || !Enum.IsDefined(decision)
            || request.Decision != decision.ToString() || request.TargetId == Guid.Empty
            || (decision is ModerationDecisionKind.Rejected or ModerationDecisionKind.Hidden && !TotpService.ReasonValid(request.Reason, 500))
            || request.Reason?.Length > 500) return Error(400, "decision_invalid");
        await using var tx = await BeginWriteAsync(ct);
        if (!await CallerCurrentAsync(http, manage: false, ct)) return Revoked();
        string? stepReason = null;
        if (request.TargetType == "urgent" && decision == ModerationDecisionKind.Restored)
        {
            stepReason = await StepAsync(http, StepUpActions.RestoreUrgent, request.TargetId.ToString(), ct);
            if (stepReason is null) return Error(403, "step_up_required");
        }
        var valid = false;
        var exists = false;
        string? previous = null;
        switch (request.TargetType)
        {
            case "adoption":
                var post = await db.AdoptionPosts.SingleOrDefaultAsync(x => x.Id == request.TargetId, ct);
                exists = post is not null;
                if (post?.State == AdoptionPostState.Pending && decision is ModerationDecisionKind.Approved or ModerationDecisionKind.Rejected)
                {
                    post.State = decision == ModerationDecisionKind.Approved ? AdoptionPostState.Published : AdoptionPostState.Rejected;
                    valid = true;
                }
                // Takedown of live content: a published post can still be rejected, with a reason.
                else if (post?.State == AdoptionPostState.Published && decision == ModerationDecisionKind.Rejected)
                {
                    post.State = AdoptionPostState.Rejected;
                    previous = nameof(AdoptionPostState.Published);
                    valid = true;
                }
                break;
            case "urgent":
                var urgent = await db.UrgentPosts.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.Id == request.TargetId, ct);
                exists = urgent is not null;
                if (urgent is not null && decision == ModerationDecisionKind.Hidden && urgent.HiddenAt is null)
                { urgent.HiddenAt = clock.GetUtcNow(); urgent.HiddenReason = request.Reason!.Trim(); valid = true; }
                else if (urgent is not null && decision == ModerationDecisionKind.Restored && urgent.HiddenAt is not null)
                { urgent.HiddenAt = null; urgent.HiddenReason = null; valid = true; }
                break;
            case "photo":
                var photo = await db.AnimalPhotos.SingleOrDefaultAsync(x => x.Id == request.TargetId, ct);
                exists = photo is not null;
                if (photo?.ModerationState == ModerationState.Pending && decision is ModerationDecisionKind.Approved or ModerationDecisionKind.Rejected)
                {
                    if (decision == ModerationDecisionKind.Approved && !await photos.IsProcessedAsync(db, photo.Key, ct))
                        return Error(409, "photo_not_processed");
                    photo.ModerationState = decision == ModerationDecisionKind.Approved ? ModerationState.Approved : ModerationState.Rejected;
                    valid = true;
                }
                else if (photo?.ModerationState == ModerationState.Approved && decision == ModerationDecisionKind.Rejected)
                {
                    photo.ModerationState = ModerationState.Rejected;
                    previous = nameof(ModerationState.Approved);
                    valid = true;
                }
                break;
            case "report":
                var report = await db.Reports.SingleOrDefaultAsync(x => x.Id == request.TargetId, ct);
                exists = report is not null;
                if (report?.State == ReportState.Pending && decision is ModerationDecisionKind.Approved or ModerationDecisionKind.Rejected)
                { report.State = decision == ModerationDecisionKind.Approved ? ReportState.Reviewed : ReportState.Dismissed; valid = true; }
                break;
            default: return Error(400, "target_type_invalid");
        }
        if (!exists) return Results.NotFound();
        if (!valid) return Error(409, "transition_invalid");
        Record(http, "moderation.decision", request.TargetType, request.TargetId, decision, request.Reason?.Trim(), stepReason,
            previous is null ? null : new { previous });
        await SaveAsync(tx, ct);
        return Results.NoContent();
    }

    public async Task<IResult> UsersAsync(string? q, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length > 254) return Error(400, "user_query_invalid");
        q = q.Trim();
        var query = db.Users.AsNoTracking();
        if (q.Contains('@'))
        {
            var email = EmailNormalizer.Normalize(q);
            query = query.Where(u => u.Email == email);
        }
        else
        {
            if (q.Length < 8 || q.Length > 36 || q.Any(c => !char.IsAsciiHexDigit(c) && c != '-')) return Error(400, "user_query_invalid");
            var prefix = q.ToLowerInvariant();
            query = query.Where(u => u.Id.ToString().StartsWith(prefix));
        }
        var users = await query.OrderBy(u => u.Id).Take(25).ToListAsync(ct);
        var result = new List<AdminUser>();
        foreach (var user in users)
            result.Add(new AdminUser(user.Id, AdminPrivacy.MaskEmail(user.Email), user.Role.ToString(), user.CreatedAt, user.TotpEnabledAt is not null,
                await db.AdoptionPosts.CountAsync(x => x.CreatedBy == user.Id, ct),
                await db.UrgentPosts.IgnoreQueryFilters().CountAsync(x => x.CreatedBy == user.Id, ct), await RejectionsAsync(user.Id, ct)));
        return Results.Ok(result);
    }

    public async Task<IResult> RoleAsync(HttpContext http, Guid id, AdminRoleRequest request, CancellationToken ct)
    {
        if (!Enum.TryParse<UserRole>(request.Role, out var role) || !Enum.IsDefined(role) || role.ToString() != request.Role)
            return Error(400, "role_invalid");
        if (id == TotpService.UserId(http.User)) return Error(409, "own_role_protected");
        await using var tx = await BeginWriteAsync(ct);
        if (!await CallerCurrentAsync(http, manage: true, ct)) return Revoked();
        var reason = await StepAsync(http, StepUpActions.RoleChange, id.ToString(), ct);
        if (reason is null) return Error(403, "step_up_required");
        var user = await totp.LockUserAsync(id, ct);
        if (user is null) return Results.NotFound();
        if (user.Role == role) return Error(409, "transition_invalid");
        if (role != UserRole.Admin && await AdminWriteLock.IsLastActiveAdminAsync(db, user, clock.GetUtcNow(), ct))
            return Error(409, "last_admin_protected");
        if (role is UserRole.Moderator or UserRole.Admin && user.TotpEnabledAt is null) return Error(409, "target_mfa_required");
        var previous = user.Role.ToString();
        user.Role = role;
        user.SessionVersion++;
        await new EfAuthStore(db).RevokeAllForUserAsync(id, clock.GetUtcNow(), ct);
        Record(http, "user.role", "user", id, ModerationDecisionKind.Approved, reason, reason, new { previous, role = request.Role });
        await SaveAsync(tx, ct);
        SessionVersionCache.Shared.Invalidate(id);
        return Results.NoContent();
    }

    public async Task<IResult> SuspendAsync(HttpContext http, Guid id, AdminSuspendRequest request, CancellationToken ct)
    {
        if (!TotpService.ReasonValid(request.Reason, 500) || request.Until <= clock.GetUtcNow()) return Error(400, "suspension_invalid");
        if (id == TotpService.UserId(http.User)) return Error(409, "own_account_protected");
        await using var tx = await BeginWriteAsync(ct);
        if (!await CallerCurrentAsync(http, manage: true, ct)) return Revoked();
        var reason = await StepAsync(http, StepUpActions.Suspend, id.ToString(), ct);
        if (reason is null) return Error(403, "step_up_required");
        var user = await totp.LockUserAsync(id, ct);
        if (user is null) return Results.NotFound();
        var now = clock.GetUtcNow();
        var until = request.Until ?? DateTimeOffset.MaxValue;
        // Shortening a running suspension would silently lift it; ending one early is the unsuspend action.
        if (user.SuspendedUntil > now && until < user.SuspendedUntil) return Error(400, "suspension_invalid");
        if (await AdminWriteLock.IsLastActiveAdminAsync(db, user, now, ct)) return Error(409, "last_admin_protected");
        user.SuspendedUntil = until;
        user.SessionVersion++;
        await new EfAuthStore(db).RevokeAllForUserAsync(id, now, ct);
        Record(http, "user.suspend", "user", id, ModerationDecisionKind.Hidden, request.Reason.Trim(), reason, new { request.Until });
        await SaveAsync(tx, ct);
        SessionVersionCache.Shared.Invalidate(id);
        return Results.NoContent();
    }

    public async Task<IResult> UnsuspendAsync(HttpContext http, Guid id, AdminUnsuspendRequest request, CancellationToken ct)
    {
        if (!TotpService.ReasonValid(request.Reason, 500)) return Error(400, "suspension_invalid");
        await using var tx = await BeginWriteAsync(ct);
        if (!await CallerCurrentAsync(http, manage: true, ct)) return Revoked();
        var reason = await StepAsync(http, StepUpActions.Unsuspend, id.ToString(), ct);
        if (reason is null) return Error(403, "step_up_required");
        var user = await totp.LockUserAsync(id, ct);
        if (user is null) return Results.NotFound();
        if (!(user.SuspendedUntil > clock.GetUtcNow())) return Error(409, "transition_invalid");
        var previous = user.SuspendedUntil;
        user.SuspendedUntil = null;
        Record(http, "user.unsuspend", "user", id, ModerationDecisionKind.Restored, request.Reason.Trim(), reason, new { previous });
        await SaveAsync(tx, ct);
        SessionVersionCache.Shared.Invalidate(id);
        return Results.NoContent();
    }

    public async Task<IResult> AuditAsync(Guid? actor, string? action, string? target, DateTimeOffset? from, DateTimeOffset? to, string? cursor, CancellationToken ct)
    {
        if (!AdminCursor.TryParse(cursor, out var after) || action?.Length > 100 || target?.Length > 100 || from > to)
            return Error(400, "audit_query_invalid");
        var query = db.AuditLogs.AsNoTracking();
        if (actor is not null) query = query.Where(x => x.ActorId == actor);
        if (action is not null) query = query.Where(x => x.Action == action);
        if (target is not null) query = Guid.TryParse(target, out var targetId) ? query.Where(x => x.TargetId == targetId) : query.Where(x => x.TargetType == target);
        if (from is not null) query = query.Where(x => x.CreatedAt >= from);
        if (to is not null) query = query.Where(x => x.CreatedAt <= to);
        if (after is not null) query = query.Where(x => x.CreatedAt < after.At || (x.CreatedAt == after.At && x.Id.CompareTo(after.Id) < 0));
        var rows = await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Take(26).ToListAsync(ct);
        return Results.Ok(new AdminPage<AdminAudit>(rows.Take(25).Select(x => new AdminAudit(x.Id, x.ActorId, x.Action, x.TargetType,
            x.TargetId, x.DetailsJson, x.CreatedAt)).ToList(), rows.Count > 25 ? AdminCursor.Encode(rows[24].CreatedAt, rows[24].Id) : null));
    }

    public async Task<IResult> CsvAsync(HttpContext http, bool commit, CancellationToken ct)
    {
        if (!http.Request.HasFormContentType) return Results.StatusCode(415);
        var form = await http.Request.ReadFormAsync(ct);
        if (form.Files.Count != 1) return Error(400, "csv_file_required");
        var file = form.Files[0];
        if (file.Length > CarePlaceCsv.MaxBytes) return Results.StatusCode(413);
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        CarePlacePreview preview;
        try { preview = await CarePlaceCsv.PreviewAsync(buffer.ToArray(), new DistrictResolver(db), ct); }
        catch (Exception ex) when (ex is FormatException or DecoderFallbackException) { return Error(400, "csv_invalid"); }
        if (!commit) return Results.Ok(preview);
        if (form["previewHash"].ToString() != preview.PreviewHash) return Error(409, "preview_hash_mismatch");
        if (preview.Rows.Any(x => x.Status != "valid")) return Error(400, "csv_rows_invalid");
        await using var tx = await BeginWriteAsync(ct);
        if (!await CallerCurrentAsync(http, manage: true, ct)) return Revoked();
        var reason = await StepAsync(http, StepUpActions.CsvCommit, preview.PreviewHash, ct);
        if (reason is null) return Error(403, "step_up_required");
        var existing = await db.CarePlaceImports.SingleOrDefaultAsync(x => x.FileHash == preview.PreviewHash, ct);
        if (existing is not null)
        {
            Record(http, "care_places.csv_retry", "care_place_import", existing.Id, ModerationDecisionKind.Approved, reason, reason);
            await SaveAsync(tx, ct);
            return Results.Ok(new CarePlaceCommit(existing.FileHash, 0, true));
        }
        var places = CarePlaceCsv.Parse(new UTF8Encoding(false, true).GetString(buffer.ToArray()), 2000);
        // Public district pages and slugs read DistrictId; the preview already proved each district resolves.
        var districts = new DistrictResolver(db);
        foreach (var place in places) place.DistrictId = await districts.ResolveAsync(place.District, ct);
        db.CarePlaces.AddRange(places);
        var import = new CarePlaceImport { FileHash = preview.PreviewHash, RowCount = places.Count };
        db.CarePlaceImports.Add(import);
        Record(http, "care_places.csv_commit", "care_place_import", import.Id, ModerationDecisionKind.Approved, reason, reason, new { import.FileHash, import.RowCount });
        await SaveAsync(tx, ct);
        return Results.Ok(new CarePlaceCommit(import.FileHash, places.Count, false));
    }

    // Authorization ran before the advisory lock. Re-read the caller under the lock, so a demotion, suspension,
    // deactivation or session revocation committed meanwhile stops this write before anything is consumed or changed.
    private async Task<bool> CallerCurrentAsync(HttpContext http, bool manage, CancellationToken ct)
    {
        if (!int.TryParse(http.User.FindFirstValue(PatikaClaims.SessionVersion), NumberStyles.None, CultureInfo.InvariantCulture, out var version))
            return false;
        var caller = await totp.LockUserAsync(TotpService.UserId(http.User), ct);
        return caller is not null && caller.SessionVersion == version && caller.DeactivatedAt is null
            && !(caller.SuspendedUntil > clock.GetUtcNow())
            && (manage ? caller.Role == UserRole.Admin : caller.Role is UserRole.Moderator or UserRole.Admin);
    }

    private static IResult Revoked() => Error(403, "admin_access_revoked");

    private Task<int> RejectionsAsync(Guid user, CancellationToken ct) => db.ModerationDecisions.CountAsync(d => d.Decision == ModerationDecisionKind.Rejected &&
        ((d.TargetType == "adoption" && db.AdoptionPosts.Any(p => p.Id == d.TargetId && p.CreatedBy == user))
        || (d.TargetType == "photo" && db.AnimalPhotos.Any(p => p.Id == d.TargetId && p.CreatedBy == user))
        || (d.TargetType == "report" && db.Reports.Any(p => p.Id == d.TargetId && p.ReporterId == user))), ct);

    // Serialize administrative writes, including last-admin checks and file-hash idempotency.
    private Task<IDbContextTransaction> BeginWriteAsync(CancellationToken ct) => AdminWriteLock.BeginAsync(db, ct);

    private Task<string?> StepAsync(HttpContext http, string action, string target, CancellationToken ct) =>
        totp.ConsumeStepUpAsync(http.User, http.Request.Headers["X-Step-Up"].ToString(), action, target, ct);
    private async Task SaveAsync(IDbContextTransaction tx, CancellationToken ct)
    {
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    private void Record(HttpContext http, string action, string type, Guid target, ModerationDecisionKind decision, string? reason, string? stepReason, object? change = null)
    {
        var actor = TotpService.UserId(http.User);
        db.ModerationDecisions.Add(new ModerationDecision
        {
            ReviewerId = actor,
            TargetType = type,
            TargetId = target,
            Decision = decision,
            Reason = reason,
            DecidedAt = clock.GetUtcNow(),
        });
        totp.Audit(actor, action, type, target, new { reason, stepUpReason = stepReason, change });
    }

    private static IResult Error(int status, string code) => TotpService.Error(status, code);
    private sealed class QueueRow
    {
        public Guid Id { get; init; }
        public DateTimeOffset CreatedAt { get; init; }
        public Guid AuthorId { get; init; }
        public required string Content { get; init; }
        public required string State { get; init; }
        public bool Hidden { get; init; }
        public string? PhotoKey { get; init; }
    }
}
