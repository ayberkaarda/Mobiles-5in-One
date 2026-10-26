using Patika.Api.Tests.Urgent;
using Patika.Infrastructure.Security;
using Xunit;

namespace Patika.Api.Tests.Auth;

public sealed class EmailBudgetPersistenceTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    [Fact]
    public async Task ConcurrentReservationsNeverExceedCapAndANewDayHasItsOwnBudget()
    {
        var day = new DateOnly(2091, 3, 4);
        var granted = await Task.WhenAll(Enumerable.Range(0, 24).Select(async _ =>
        {
            await using var db = database.CreateContext();
            return await new DailySendBudget(db).ReserveEmailAsync(day, 5, TestContext.Current.CancellationToken);
        }));
        Assert.Equal(5, granted.Count(g => g));
        await using var context = database.CreateContext();
        var budget = new DailySendBudget(context);
        Assert.False(await budget.ReserveEmailAsync(day, 5, TestContext.Current.CancellationToken));
        await budget.ReleaseEmailAsync(day, TestContext.Current.CancellationToken);
        Assert.True(await budget.ReserveEmailAsync(day, 5, TestContext.Current.CancellationToken));
        Assert.True(await budget.ReserveEmailAsync(day.AddDays(1), 5, TestContext.Current.CancellationToken));
    }
}
