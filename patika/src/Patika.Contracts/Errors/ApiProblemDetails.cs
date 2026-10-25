using System.Text.Json.Serialization;

namespace Patika.Contracts.Errors;

public class ApiProblemDetails
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = "about:blank";

    [JsonPropertyName("title")]
    public required string Title { get; init; }

    [JsonPropertyName("status")]
    public int Status { get; init; }

    [JsonPropertyName("detail")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Detail { get; init; }

    [JsonPropertyName("instance")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Instance { get; init; }

    [JsonPropertyName("code")]
    public required string Code { get; init; }

    [JsonPropertyName("traceId")]
    public required string TraceId { get; init; }
}

public sealed class ApiValidationProblemDetails : ApiProblemDetails
{
    [JsonPropertyName("errors")]
    public required IReadOnlyDictionary<string, string[]> Errors { get; init; }
}
