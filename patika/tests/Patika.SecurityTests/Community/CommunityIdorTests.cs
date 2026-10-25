using System.Data;
using System.Data.Common;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Patika.Api.Features.Animals;
using Patika.Api.Features.Stations;
using Patika.Api.Security.Tokens;
using Patika.Api.Tests.Infrastructure;
using Patika.Contracts.Community;
using Patika.Domain;
using Patika.Domain.Entities;
using Patika.Domain.Security;
using Patika.Infrastructure.Persistence;
using Xunit;

namespace Patika.SecurityTests.Community;

public sealed class CommunityIdorTests
{
    [Theory]
    [InlineData(false, ActorRole.User, false)]
    [InlineData(false, ActorRole.Trusted, true)]
    [InlineData(false, ActorRole.Moderator, true)]
    [InlineData(false, ActorRole.Admin, true)]
    [InlineData(true, ActorRole.User, false)]
    [InlineData(true, ActorRole.Trusted, false)]
    [InlineData(true, ActorRole.Moderator, true)]
    [InlineData(true, ActorRole.Admin, true)]
    public async Task CommunityOwnershipUsesExistingIdorHarness(bool animal, ActorRole role, bool allowed)
    {
        await using var factory = new PatikaApiFactory();
        using var harness = await IdorHarness.CreateAsync(factory);
        var permission = animal ? Permission.AnimalsUpdate : Permission.StationsUpdate;
        Assert.Equal(allowed, await harness.AuthorizeAsync(harness.AttackerId, role, new OwnedResource(harness.VictimId), permission));
        Assert.True(await harness.AuthorizeAsync(harness.VictimId, role, new OwnedResource(harness.VictimId), permission));
    }

    [Theory]
    [InlineData(false, ActorRole.User)]
    [InlineData(true, ActorRole.User)]
    [InlineData(true, ActorRole.Trusted)]
    public async Task ActualUpdateHandlerDeniesForeignResourceWithoutSaving(bool animal, ActorRole role)
    {
        await using var factory = new PatikaApiFactory();
        using var harness = await IdorHarness.CreateAsync(factory);
        Entity victimResource = animal
            ? new Animal { CreatedBy = harness.VictimId, Location = new GeoPoint(29, 41), Name = "Kedi" }
            : new Station { CreatedBy = harness.VictimId, Location = new GeoPoint(29, 41), PhotoKey = "station/a.jpg", Name = "İstasyon" };
        var interceptor = new ResourceReader(victimResource);
        var options = new DbContextOptionsBuilder<PatikaDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=1;Database=community", pg => pg.UseNetTopologySuite())
            .AddInterceptors(new SuppressConnection(), interceptor).Options;
        await using var db = new PatikaDbContext(options);
        interceptor.Context = db;
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(PatikaClaims.Subject, harness.AttackerId.ToString()),
                new Claim(PatikaClaims.Role, role.ToString())], "test"))
        };
        var authorization = factory.Services.GetRequiredService<IAuthorizationService>();
        var result = animal
            ? await AnimalEndpoints.UpdateAsync(victimResource.Id, new AnimalUpdateRequest(Name: "Değişti"), http, db, authorization, TestContext.Current.CancellationToken)
            : await StationEndpoints.UpdateAsync(victimResource.Id, new StationUpdateRequest(Name: "Değişti"), http, db, authorization, TestContext.Current.CancellationToken);
        Assert.IsType<ForbidHttpResult>(result);
        Assert.False(db.ChangeTracker.HasChanges());
        Assert.Equal(1, interceptor.Reads);
    }

    [Theory]
    [InlineData(ActorRole.User)]
    [InlineData(ActorRole.Trusted)]
    [InlineData(ActorRole.Moderator)]
    [InlineData(ActorRole.Admin)]
    public async Task FollowPermissionNeverAllowsAnotherUsersSubscription(ActorRole role)
    {
        await using var factory = new PatikaApiFactory();
        using var harness = await IdorHarness.CreateAsync(factory);
        Assert.False(await harness.AuthorizeAsync(harness.AttackerId, role, new OwnedResource(harness.VictimId), Permission.AnimalFollow));
        Assert.True(await harness.AuthorizeAsync(harness.AttackerId, role, new OwnedResource(harness.AttackerId), Permission.AnimalFollow));
    }

    private sealed class SuppressConnection : DbConnectionInterceptor
    {
        public override ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(InterceptionResult.Suppress());
    }

    private sealed class ResourceReader(Entity resource) : DbCommandInterceptor
    {
        public PatikaDbContext Context { get; set; } = null!;
        public int Reads { get; private set; }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Reads++;
            var properties = Context.Model.FindEntityType(resource.GetType())!.GetProperties().ToArray();
            var table = new DataTable();
            var values = new object[properties.Length];
            for (var i = 0; i < properties.Length; i++)
            {
                var property = properties[i];
                var converter = property.GetTypeMapping().Converter;
                var value = property.PropertyInfo!.GetValue(resource);
                var providerValue = converter is null ? value : converter.ConvertToProvider(value);
                var providerType = converter?.ProviderClrType ?? property.ClrType;
                table.Columns.Add(property.GetColumnName(), Nullable.GetUnderlyingType(providerType) ?? providerType);
                values[i] = providerValue ?? DBNull.Value;
            }
            table.Rows.Add(values);
            return ValueTask.FromResult(InterceptionResult<DbDataReader>.SuppressWithResult(table.CreateDataReader()));
        }
    }
}
