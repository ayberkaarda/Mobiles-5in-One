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

/// <summary>One listed object: its name, the store's timestamp, its size and whether its <c>.sha256</c> sidecar exists.</summary>
public sealed record BackupCandidate(string Name, DateTimeOffset? ObjectTime, long Size, bool HasChecksum);

public sealed record BackupObject(string Name, DateTimeOffset CreatedAt);

/// <summary>Lists backup objects; only <c>patika-*.dump.age</c> names count.</summary>
public interface IBackupCatalog
{
    Task<IReadOnlyList<BackupCandidate>> ListAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The outcome of choosing the newest backup. <see cref="Newest"/> is the newest usable dump (non-empty, with its
/// <c>.sha256</c> sidecar, not dated in the future). <see cref="Invalid"/> is a newer dump that fails those checks
/// (empty or without a sidecar, for example a truncated or planted file). <see cref="IgnoredFuture"/> counts names or
/// object times more than <see cref="BackupNames.ClockSkew"/> ahead of now, which never count as fresh.
/// </summary>
public sealed record BackupSelection(BackupObject? Newest, BackupObject? Invalid, int IgnoredFuture);

public static class BackupNames
{
    private const string Prefix = "patika-";
    private const string Suffix = ".dump.age";

    /// <summary>Allowed difference between the backup host's clock and the Worker's.</summary>
    public static readonly TimeSpan ClockSkew = TimeSpan.FromMinutes(5);

    public static bool IsDump(string name)
    {
        var file = name[(name.LastIndexOf('/') + 1)..];
        return file.StartsWith(Prefix, StringComparison.Ordinal) && file.EndsWith(Suffix, StringComparison.Ordinal);
    }

    /// <summary>The UTC stamp in <c>patika-20261026T030151Z.dump.age</c>; the object time is the fallback.</summary>
    public static DateTimeOffset? Created(string name, DateTimeOffset? objectTime)
    {
        if (!IsDump(name))
        {
            return null;
        }

        var file = name[(name.LastIndexOf('/') + 1)..];
        var stamp = file[Prefix.Length..^Suffix.Length];
        return DateTimeOffset.TryParseExact(stamp, "yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var created)
            ? created
            : objectTime;
    }

    public static BackupSelection Select(IEnumerable<BackupCandidate> candidates, DateTimeOffset now)
    {
        var latest = now + ClockSkew;
        var dated = candidates
            .Select(c => (Candidate: c, Created: Created(c.Name, c.ObjectTime)))
            .Where(d => d.Created is not null)
            .ToList();
        var future = dated.Count(d => d.Created > latest || d.Candidate.ObjectTime > latest);
        var current = dated.Where(d => d.Created <= latest && !(d.Candidate.ObjectTime > latest)).ToList();
        var newest = current.Where(d => d.Candidate.Size > 0 && d.Candidate.HasChecksum)
            .OrderByDescending(d => d.Created)
            .Select(d => new BackupObject(d.Candidate.Name, d.Created!.Value))
            .FirstOrDefault();
        var invalid = current
            .Where(d => (d.Candidate.Size <= 0 || !d.Candidate.HasChecksum) && (newest is null || d.Created > newest.CreatedAt))
            .OrderByDescending(d => d.Created)
            .Select(d => new BackupObject(d.Candidate.Name, d.Created!.Value))
            .FirstOrDefault();
        return new BackupSelection(newest, invalid, future);
    }
}

public sealed class DirectoryBackupCatalog(string directory) : IBackupCatalog
{
    public Task<IReadOnlyList<BackupCandidate>> ListAsync(CancellationToken cancellationToken)
    {
        if (!System.IO.Directory.Exists(directory))
        {
            return Task.FromResult<IReadOnlyList<BackupCandidate>>([]);
        }

        var files = new DirectoryInfo(directory).EnumerateFiles("patika-*").ToDictionary(f => f.Name, StringComparer.Ordinal);
        return Task.FromResult<IReadOnlyList<BackupCandidate>>([.. files.Values
            .Where(f => BackupNames.IsDump(f.Name))
            .Select(f => new BackupCandidate(f.Name, new DateTimeOffset(f.LastWriteTimeUtc, TimeSpan.Zero), f.Length,
                files.TryGetValue(f.Name + ".sha256", out var sum) && sum.Length > 0))]);
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

    public async Task<IReadOnlyList<BackupCandidate>> ListAsync(CancellationToken cancellationToken)
    {
        var objects = new Dictionary<string, S3Object>(StringComparer.Ordinal);
        var request = new ListObjectsV2Request { BucketName = bucket, Prefix = prefix + "patika-" };
        ListObjectsV2Response response;
        do
        {
            response = await client.ListObjectsV2Async(request, cancellationToken);
            foreach (var item in response.S3Objects ?? []) objects[item.Key] = item;
            request.ContinuationToken = response.NextContinuationToken;
        }
        while (response.IsTruncated == true);
        return [.. objects.Values
            .Where(o => BackupNames.IsDump(o.Key))
            .Select(o => new BackupCandidate(o.Key,
                o.LastModified is { } modified ? new DateTimeOffset(modified.ToUniversalTime(), TimeSpan.Zero) : null,
                o.Size ?? 0, objects.TryGetValue(o.Key + ".sha256", out var sum) && (sum.Size ?? 0) > 0))];
    }

    public void Dispose() => client.Dispose();
}

public sealed record BackupStatus(bool Configured, BackupObject? Newest, TimeSpan? Age, bool Stale)
{
    /// <summary>A newer dump than <see cref="BackupStatus.Newest"/> that is empty or has no checksum sidecar.</summary>
    public BackupObject? Invalid { get; init; }

    public int IgnoredFuture { get; init; }
}

/// <summary>
/// <c>backup.verify</c> (security checklist item 20): the newest usable backup must be younger than
/// <see cref="BackupSettings.MaxAgeHours"/>. Usable means non-empty, with the <c>.sha256</c> sidecar backup.sh writes,
/// and not dated more than <see cref="BackupNames.ClockSkew"/> in the future (a planted far-future name cannot keep
/// the check quiet). A stale or missing backup, a newer dump that is empty or has no sidecar, or a listing that fails
/// writes a warning and mails <c>Ops:AlertEmail</c> once per UTC day.
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
        BackupSelection selection;
        try
        {
            selection = BackupNames.Select(await catalog.ListAsync(cancellationToken), now);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning("backup.verify: listing the backup location failed ({Failure})", exception.GetType().Name);
            await AlertAsync(now, "backup.verify: listing failed",
                $"Listing the backup location failed ({exception.GetType().Name}); the newest backup could not be checked.", cancellationToken);
            return new BackupStatus(true, null, null, true);
        }

        if (selection.IgnoredFuture > 0)
        {
            logger.LogWarning("backup.verify: ignored {Count} backup objects dated more than {SkewMinutes} minutes in the future",
                selection.IgnoredFuture, BackupNames.ClockSkew.TotalMinutes);
        }

        var newest = selection.Newest;
        var age = newest is null ? (TimeSpan?)null : now - newest.CreatedAt;
        if (newest is not null && age <= limit && selection.Invalid is null)
        {
            logger.LogInformation("backup.verify: newest backup is {AgeHours:0.0} h old", age.Value.TotalHours);
            return new BackupStatus(true, newest, age, false) { IgnoredFuture = selection.IgnoredFuture };
        }

        var text = selection.Invalid is { } invalid
            ? string.Create(CultureInfo.InvariantCulture,
                $"The newest backup object {invalid.Name} is empty or has no .sha256 sidecar; the newest usable one is {(newest is null ? "missing" : $"{newest.Name}, {age!.Value.TotalHours:0.0} h old")}.")
            : newest is null
                ? string.Create(CultureInfo.InvariantCulture, $"No usable backup found; the limit is {options.Value.MaxAgeHours} h.")
                : string.Create(CultureInfo.InvariantCulture,
                    $"The newest backup {newest.Name} is {age!.Value.TotalHours:0.0} h old; the limit is {options.Value.MaxAgeHours} h.");
        if (selection.IgnoredFuture > 0)
        {
            text += string.Create(CultureInfo.InvariantCulture, $" {selection.IgnoredFuture} future-dated objects were ignored.");
        }

        logger.LogWarning("backup.verify: {Detail}", text);
        await AlertAsync(now, selection.Invalid is null ? "backup.verify: backup is stale" : "backup.verify: backup is invalid", text, cancellationToken);
        return new BackupStatus(true, newest, age, true) { Invalid = selection.Invalid, IgnoredFuture = selection.IgnoredFuture };
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
