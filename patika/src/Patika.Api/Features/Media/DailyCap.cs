using System.Globalization;

namespace Patika.Api.Features.Media;

/// <summary>The 429 body for a per-user daily cap, with <c>Retry-After</c> pointing at the next local day.</summary>
public static class DailyCap
{
    public static IResult Reached(HttpContext http, DateTimeOffset now, string title, string code)
    {
        var seconds = Math.Max(1, (int)Math.Ceiling(PatikaDay.UntilNextDay(now).TotalSeconds));
        http.Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
        return TypedResults.Problem(
            title: title,
            statusCode: StatusCodes.Status429TooManyRequests,
            extensions: new Dictionary<string, object?> { ["code"] = code });
    }
}
