using System.Collections.Concurrent;
using Patika.Worker.Jobs.Media;
using Patika.Worker.Jobs.Push;

namespace Patika.Worker.Tests;

public sealed class InMemoryObjectStore : IObjectStore
{
    public ConcurrentDictionary<string, StoredObject> Objects { get; } = new(StringComparer.Ordinal);

    public void Add(string key, byte[] content, string contentType) =>
        Objects[key] = new StoredObject(content, contentType, content.Length);

    public Task<IReadOnlyList<string>> ListAsync(string prefix, int max, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<string>>([.. Objects.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).Order().Take(max)]);

    public Task<long?> GetLengthAsync(string key, CancellationToken cancellationToken) =>
        Task.FromResult(Objects.TryGetValue(key, out var value) ? value.Length : (long?)null);

    public Task<StoredObject?> GetAsync(string key, CancellationToken cancellationToken) =>
        Task.FromResult(Objects.GetValueOrDefault(key));

    public Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken)
    {
        Add(key, content, contentType);
        return Task.CompletedTask;
    }

    public Task CopyAsync(string sourceKey, string destinationKey, CancellationToken cancellationToken)
    {
        Objects[destinationKey] = Objects[sourceKey];
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        Objects.TryRemove(key, out _);
        return Task.CompletedTask;
    }
}

public sealed class InMemoryUploadStates : IUploadStateStore
{
    public ConcurrentDictionary<string, UploadRecord> Records { get; } = new(StringComparer.Ordinal);

    public ConcurrentDictionary<string, string?> Failures { get; } = new(StringComparer.Ordinal);

    public Task<UploadRecord?> FindAsync(string photoKey, CancellationToken cancellationToken) =>
        Task.FromResult(Records.GetValueOrDefault(photoKey));

    public Task MarkAsync(string photoKey, string state, string? failureCode, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Records[photoKey] = Records[photoKey] with { State = state };
        Failures[photoKey] = failureCode;
        return Task.CompletedTask;
    }
}

/// <summary>Records every push instead of calling a provider. Tokens listed in <see cref="Invalid"/> report as unregistered.</summary>
public sealed class FakePushSender : IPushSender
{
    public ConcurrentQueue<PushMessage> Sent { get; } = new();

    public HashSet<string> Invalid { get; } = new(StringComparer.Ordinal);

    public Task<PushOutcome> SendAsync(PushMessage message, CancellationToken cancellationToken)
    {
        if (Invalid.Contains(message.Token))
        {
            return Task.FromResult(PushOutcome.InvalidToken);
        }

        Sent.Enqueue(message);
        return Task.FromResult(PushOutcome.Sent);
    }
}

public sealed class InMemoryPushCounters : IPushCounterStore
{
    private readonly Lock gate = new();
    private readonly Dictionary<(DateOnly, string), int> counts = [];

    public Task<int> ReserveAsync(DateOnly day, string channel, int requested, int cap, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            var current = counts.GetValueOrDefault((day, channel));
            var granted = Math.Max(0, Math.Min(requested, cap - current));
            counts[(day, channel)] = current + granted;
            return Task.FromResult(granted);
        }
    }

    public Task ReleaseAsync(DateOnly day, string channel, int count, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            counts[(day, channel)] = Math.Max(0, counts.GetValueOrDefault((day, channel)) - count);
        }

        return Task.CompletedTask;
    }

    public Task<int> CountAsync(DateOnly day, string channel, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            return Task.FromResult(counts.GetValueOrDefault((day, channel)));
        }
    }
}

public sealed class RecordingAlertNotifier : ICostAlertNotifier
{
    public List<(BudgetUsage Usage, CostAlertLevel Level)> Alerts { get; } = [];

    public Task AlertAsync(DateOnly day, BudgetUsage usage, CostAlertLevel level, CancellationToken cancellationToken)
    {
        Alerts.Add((usage, level));
        return Task.CompletedTask;
    }
}

public sealed class FixedClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;
}
