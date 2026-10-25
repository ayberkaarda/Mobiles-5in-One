namespace Patika.Api.Features.Media;

/// <summary>S3-compatible object storage (MinIO locally, Cloudflare R2 in production).</summary>
public sealed class StorageSettings
{
    public const string SectionName = "Storage";

    /// <summary>Endpoint the API and worker talk to, for example <c>http://minio:9000</c>.</summary>
    public string? Endpoint { get; set; }

    /// <summary>Endpoint the phone uploads to; the presigned signature covers this host. Defaults to <see cref="Endpoint"/>.</summary>
    public string? PublicEndpoint { get; set; }

    public string Bucket { get; set; } = "patika-local";

    public string? AccessKey { get; set; }

    public string? SecretKey { get; set; }

    /// <summary><c>auto</c> for R2; MinIO accepts <c>us-east-1</c>.</summary>
    public string Region { get; set; } = "us-east-1";
}

public sealed class MediaSettings
{
    public const string SectionName = "Media";

    public int DailyQuota { get; set; } = 30;

    /// <summary>Quota for an active Patika Destekçi entitlement.</summary>
    public int SupporterDailyQuota { get; set; } = 100;

    public int PresignMinutes { get; set; } = 5;
}

/// <summary>Calendar day in Türkiye (UTC+3 all year since 2016), used for every daily cap.</summary>
public static class PatikaDay
{
    public static readonly TimeSpan Offset = TimeSpan.FromHours(3);

    /// <summary>Start of the local day containing <paramref name="now"/>, as a UTC instant.</summary>
    public static DateTimeOffset StartOf(DateTimeOffset now)
    {
        var local = now.ToOffset(Offset);
        return new DateTimeOffset(local.Year, local.Month, local.Day, 0, 0, 0, Offset).ToUniversalTime();
    }

    public static TimeSpan UntilNextDay(DateTimeOffset now) => StartOf(now).AddDays(1) - now;
}
