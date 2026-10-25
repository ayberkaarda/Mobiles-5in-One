namespace Patika.Domain.Entities;

public sealed class PushDailyCounter
{
    public DateOnly Day { get; set; }
    public required string Channel { get; set; }
    public int Count { get; set; }
}
