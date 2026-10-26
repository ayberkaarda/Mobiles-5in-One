using Patika.Api.Tests.Urgent;
using Patika.Infrastructure.Security;
using Xunit;

namespace Patika.Api.Tests.Auth;

public sealed class EmailBudgetPersistenceTests(FeaturePostgisFixture database) : IClassFixture<FeaturePostgisFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task ConcurrentReservationsNeverExceedCapAndANewDayHasItsOwnBudget()
    {
        var day = new DateOnly(2091, 3, 4);
        const string channel = EmailBudgetChannels.NonCritical;
        var granted = await Task.WhenAll(Enumerable.Range(0, 24).Select(async _ =>
        {
            await using var db = database.CreateContext();
            return await new DailySendBudget(db).ReserveEmailAsync(day, channel, 5, Ct);
        }));
        Assert.Equal(5, granted.Count(g => g));
        await using var context = database.CreateContext();
        var budget = new DailySendBudget(context);
        Assert.False(await budget.ReserveEmailAsync(day, channel, 5, Ct));
        await budget.ReleaseEmailAsync(day, channel, Ct);
        Assert.Equal(4, await budget.CountAsync(day, channel, Ct));
        Assert.True(await budget.ReserveEmailAsync(day, channel, 5, Ct));
        Assert.True(await budget.ReserveEmailAsync(day.AddDays(1), channel, 5, Ct));
    }

    [Fact]
    public async Task TheCriticalChannelIsCountedSeparately()
    {
        var day = new DateOnly(2091, 3, 9);
        await using var context = database.CreateContext();
        var budget = new DailySendBudget(context);
        Assert.True(await budget.ReserveEmailAsync(day, EmailBudgetChannels.NonCritical, 1, Ct));
        Assert.False(await budget.ReserveEmailAsync(day, EmailBudgetChannels.NonCritical, 1, Ct));
        Assert.True(await budget.ReserveEmailAsync(day, EmailBudgetChannels.Critical, 2, Ct));
        Assert.True(await budget.ReserveEmailAsync(day, EmailBudgetChannels.Critical, 2, Ct));
        Assert.False(await budget.ReserveEmailAsync(day, EmailBudgetChannels.Critical, 2, Ct));
        Assert.Equal(1, await budget.CountAsync(day, EmailBudgetChannels.NonCritical, Ct));
        Assert.Equal(2, await budget.CountAsync(day, EmailBudgetChannels.Critical, Ct));
    }

    [Fact]
    public void TheDailyBudgetResetsAtLocalMidnight()
    {
        Assert.Equal(TimeSpan.FromHours(3), DailySendBudget.UntilNextDay(new DateTimeOffset(2026, 10, 25, 18, 0, 0, TimeSpan.Zero)));
        Assert.Equal(TimeSpan.FromHours(24), DailySendBudget.UntilNextDay(new DateTimeOffset(2026, 10, 25, 21, 0, 0, TimeSpan.Zero)));
    }
}
