using Microsoft.EntityFrameworkCore;
using Patika.Infrastructure.Persistence;

namespace Patika.Web.Services;

/// <summary>
/// The only context the public site resolves: no tracking, and every save throws before anything is
/// prepared or sent. Production pairs it with a SELECT-only role (docs/public-web-data.md), which also
/// covers ExecuteUpdate/ExecuteDelete and raw SQL that this override cannot see.
/// </summary>
public sealed class PublicReadContext(DbContextOptions<PatikaDbContext> options) : PatikaDbContext(options)
{
    public const string ReadOnlyMessage = "The public web database is read-only.";

    public override int SaveChanges(bool acceptAllChangesOnSuccess) =>
        throw new InvalidOperationException(ReadOnlyMessage);

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException(ReadOnlyMessage);
}
