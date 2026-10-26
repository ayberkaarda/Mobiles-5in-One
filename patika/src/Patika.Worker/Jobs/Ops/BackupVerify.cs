using System.Globalization;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Quartz;

namespace Patika.Worker.Jobs.Ops;

/// <summary>
/// Where <c>ops/backup/backup.sh</c> leaves its encrypted dumps (docs/ops/backup-restore.md). Set either
/// <see cref="Directory"/> (the host's <c>PATIKA_BACKUP_DIR</c>, mounted read-only) or the S3 keys (the bucket and
/// prefix of <c>PATIKA_BACKUP_S3_URI</c>, with a list-only key). Nothing set means the check is off.
/// </summary>
public sealed class BackupSettings
{
    public const string SectionName = "Backup";

    public string? Directory { get; set; }

    public string? S3Endpoint { get; set; }

    public string? S3Bucket { get; set; }

    public string S3Prefix { get; set; } = "";

    public string? S3AccessKey { get; set; }

    public string? S3SecretKey { get; set; }

    public string S3Region { get; set; } = "auto";

    /// <summary>A daily backup plus two hours of slack.</summary>
    public int MaxAgeHours { get; set; } = 26;

    public bool UsesS3 => !string.IsNullOrWhiteSpace(S3Bucket);

    public bool IsConfigured => UsesS3 || !string.IsNullOrWhiteSpace(Directory);
}

public sealed record BackupObject(string Name, DateTimeOffset CreatedAt);

/// <summary>Lists backup objects; only <c>patika-*.dump.age</c> names count.</summary>
public interface IBackupCatalog
{
    Task<BackupObject?> NewestAsync(CancellationToken cancellationToken);
}

public static class BackupNames
{
    private const string Prefix = "patika-";
    private const string Suffix = ".dump.age";

    /// <summary>The UTC stamp in <c>patika-20261026T030151Z.dump.age</c>; the object time is the fallback.</summary>
    public static DateTimeOffset? Created(string name, DateTimeOffset? objectTime)
    {
        var file = name[(name.LastIndexOf('/') + 1)..];
        if (!file.StartsWith(Prefix, StringComparison.Ordinal) || !file.EndsWith(Suffix, StringComparison.Ordinal))
        {
            return null;
        }

        var stamp = file[Prefix.Length..^Suffix.Length];
        return DateTimeOffset.TryParseExact(stamp, "yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var created)
            ? created
            : objectTime;
    }

    public static BackupObject? Newest(IEnumerable<(string Name, DateTimeOffset? ObjectTime)> objects) => objects
        .Select(o => Created(o.Name, o.ObjectTime) is { } created ? new BackupObject(o.Name, created) : null)
        .OfType<BackupObject>()
        .MaxBy(o => o.CreatedAt);
}

public sealed class DirectoryBackupCatalog(string directory) : IBackupCatalog
{
    public Task<BackupObject?> NewestAsync(CancellationToken cancellationToken)
    {
        if (!System.IO.Directory.Exists(directory))
        {
            return Task.FromResult<BackupObject?>(null);
        }

        return Task.FromResult(BackupNames.Newest(new DirectoryInfo(directory).EnumerateFiles("patika-*.dump.age")
            .Select(f => (f.Name, (DateTimeOffset?)new DateTimeOffset(f.LastWriteTimeUtc, TimeSpan.Zero)))));
    }
}

public sealed class S3BackupCatalog : IBackupCatalog, IDisposable
{
    private readonly AmazonS3Client client;
    private readonly string bucket;
    private readonly string prefix;

    public S3BackupCatalog(BackupSettings settings)
    {
        var endpoint = new Uri(settings.S3Endpoint ?? throw new InvalidOperationException("Backup:S3Endpoint is not configured."));
        bucket = settings.S3Bucket!;
        prefix = settings.S3Prefix.Trim('/') is { Length: > 0 } trimmed ? trimmed + "/" : "";
        client = new AmazonS3Client(
            new BasicAWSCredentials(
                settings.S3AccessKey ?? throw new InvalidOperationException("Backup:S3AccessKey is not configured."),
                settings.S3SecretKey ?? throw new InvalidOperationException("Backup:S3SecretKey is not configured.")),
            new AmazonS3Config
            {
                ServiceURL = endpoint.GetLeftPart(UriPartial.Authority),
                ForcePathStyle = true,
                AuthenticationRegion = settings.S3Region,
                UseHttp = endpoint.Scheme == Uri.UriSchemeHttp,
                RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
                ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
            });
    }

    public async Task<BackupObject?> NewestAsync(CancellationToken cancellationToken)
    {
        var objects = new List<(string, DateTimeOffset?)>();
        var request = new ListObjectsV2Request { BucketName = bucket, Prefix = prefix + "patika-" };
        ListObjectsV2Response response;
        do
        {
            response = await client.ListObjectsV2Async(request, cancellationToken);
            objects.AddRange((response.S3Objects ?? []).Select(o =>
                (o.Key, o.LastModified is { } modified ? new DateTimeOffset(modified.ToUniversalTime(), TimeSpan.Zero) : (DateTimeOffset?)null)));
            request.ContinuationToken = response.NextContinuationToken;
        }
        while (response.IsTruncated == true);
        return BackupNames.Newest(objects);
    }

    public void Dispose() => client.Dispose();
}

public sealed record BackupStatus(bool Configured, BackupObject? Newest, TimeSpan? Age, bool Stale);

/// <summary>
/// <c>backup.verify</c> (security checklist item 20): the newest backup must be younger than
/// <see cref="BackupSettings.MaxAgeHours"/>. A stale or missing backup, or a listing that fails, writes a warning and
/// mails <c>Ops:AlertEmail</c> once per UTC day.
/// </summary>
public sealed class BackupVerifier(
    IOptions<BackupSettings> options, IBackupCatalog catalog, TimeProvider clock, IOpsAlerts alerts,
    BackupAlertState state, ILogger<BackupVerifier> logger)
{
    public async Task<BackupStatus> VerifyAsync(CancellationToken cancellationToken)
    {
        if (!options.Value.IsConfigured)
        {
            return new BackupStatus(false, null, null, false);
        }

        var now = clock.GetUtcNow();
        var limit = TimeSpan.FromHours(options.Value.MaxAgeHours);
        BackupObject? newest;
        try
        {
            newest = await catalog.NewestAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning("backup.verify: listing the backup location failed ({Failure})", exception.GetType().Name);
            await AlertAsync(now, "backup.verify: listing failed",
                $"Listing the backup location failed ({exception.GetType().Name}); the newest backup could not be checked.", cancellationToken);
            return new BackupStatus(true, null, null, true);
        }

        var age = newest is null ? (TimeSpan?)null : now - newest.CreatedAt;
        if (newest is not null && age <= limit)
        {
            logger.LogInformation("backup.verify: newest backup is {AgeHours:0.0} h old", age.Value.TotalHours);
            return new BackupStatus(true, newest, age, false);
        }

        var text = newest is null
            ? string.Create(CultureInfo.InvariantCulture, $"No backup found; the limit is {options.Value.MaxAgeHours} h.")
            : string.Create(CultureInfo.InvariantCulture,
                $"The newest backup {newest.Name} is {age!.Value.TotalHours:0.0} h old; the limit is {options.Value.MaxAgeHours} h.");
        logger.LogWarning("backup.verify: {Detail}", text);
        await AlertAsync(now, "backup.verify: backup is stale", text, cancellationToken);
        return new BackupStatus(true, newest, age, true);
    }

    private Task AlertAsync(DateTimeOffset now, string subject, string text, CancellationToken cancellationToken) =>
        state.TryMarkAlerted(DateOnly.FromDateTime(now.UtcDateTime)) ? alerts.RaiseAsync(subject, text, cancellationToken) : Task.CompletedTask;
}

/// <summary>The last UTC day a backup alert was mailed by this process.</summary>
public sealed class BackupAlertState
{
    private DateOnly? alerted;
    private readonly Lock gate = new();

    public bool TryMarkAlerted(DateOnly day)
    {
        lock (gate)
        {
            if (alerted == day)
            {
                return false;
            }

            alerted = day;
            return true;
        }
    }
}

[DisallowConcurrentExecution]
public sealed class BackupVerifyJob(BackupVerifier verifier) : IJob
{
    public const string Name = "backup.verify";

    public Task Execute(IJobExecutionContext context) => verifier.VerifyAsync(context.CancellationToken);
}

public static class BackupVerifySetup
{
    public static IServiceCollection AddBackupVerify(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<BackupSettings>().Bind(configuration.GetSection(BackupSettings.SectionName));
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<IBackupCatalog>(provider =>
        {
            var settings = provider.GetRequiredService<IOptions<BackupSettings>>().Value;
            return settings.UsesS3 ? new S3BackupCatalog(settings) : new DirectoryBackupCatalog(settings.Directory ?? "");
        });
        services.AddSingleton<BackupAlertState>();
        services.AddScoped<BackupVerifier>();
        return services;
    }

    /// <summary>Hourly, at minute 40.</summary>
    public static IServiceCollectionQuartzConfigurator AddBackupVerifyJob(this IServiceCollectionQuartzConfigurator quartz)
    {
        var key = new JobKey(BackupVerifyJob.Name);
        quartz.AddJob<BackupVerifyJob>(job => job.WithIdentity(key));
        quartz.AddTrigger(trigger => trigger
            .WithIdentity(BackupVerifyJob.Name + ".hourly")
            .ForJob(key)
            .WithCronSchedule("0 40 * * * ?", cron => cron.InTimeZone(TimeZoneInfo.Utc)));
        return quartz;
    }
}
