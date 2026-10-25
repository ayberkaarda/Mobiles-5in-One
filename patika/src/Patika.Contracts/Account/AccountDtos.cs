using System.Text.Json.Serialization;

namespace Patika.Contracts.Account;

public sealed record AccountDeletionResponse(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("executeAfter")] DateTimeOffset ExecuteAfter)
{
    public const string Scheduled = "deletion_scheduled";
}
