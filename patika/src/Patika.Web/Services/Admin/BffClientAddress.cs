using System.Net.Http.Json;
using Patika.Contracts.Dto;
using Patika.Infrastructure.Security;

namespace Patika.Web.Services.Admin;

/// <summary>
/// Every request on the <c>PatikaAdmin</c> client (console calls and cookie refreshes alike) carries the browser's
/// address and the shared key, so each administrator has their own API rate-limit bucket. Without a key, or outside
/// a browser request, nothing is added.
/// </summary>
public sealed class BffClientAddressHandler(IHttpContextAccessor accessor, IConfiguration configuration) : DelegatingHandler
{
    private readonly string? key = TrustedNetwork.ReadBffKey(configuration);

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (key is not null && accessor.HttpContext?.Connection.RemoteIpAddress is { } address
            && !request.Headers.Contains(TrustedNetwork.ClientHeader))
        {
            request.Headers.Add(TrustedNetwork.ClientHeader, address.ToString());
            request.Headers.Add(TrustedNetwork.KeyHeader, key);
        }

        return base.SendAsync(request, cancellationToken);
    }
}

/// <summary>
/// Asks the API whether it accepts this console's client-address claims (<c>GET /v1/health/bff</c>), so a wrong
/// <c>Network:BffAddress</c> or key shows up at startup and in <c>/healthz/bff</c> instead of as one shared
/// sign-in bucket for every administrator.
/// </summary>
public sealed class BffSelfCheck(IHttpClientFactory clients, IConfiguration configuration, ILogger<BffSelfCheck> logger)
{
    /// <summary>A documentation address (RFC 5737), never a real client.</summary>
    public const string ProbeAddress = "192.0.2.1";

    public bool Configured => TrustedNetwork.ReadBffKey(configuration) is not null;

    /// <summary>Null when no key is configured; otherwise whether the API accepted the claim.</summary>
    public async Task<bool?> CheckAsync(CancellationToken cancellationToken)
    {
        var key = TrustedNetwork.ReadBffKey(configuration);
        if (key is null)
        {
            return null;
        }

        using var client = clients.CreateClient("PatikaAdmin");
        using var request = new HttpRequestMessage(HttpMethod.Get, "v1/health/bff");
        request.Headers.Add(TrustedNetwork.ClientHeader, ProbeAddress);
        request.Headers.Add(TrustedNetwork.KeyHeader, key);
        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        var accepted = (await response.Content.ReadFromJsonAsync<BffCheckResponse>(cancellationToken))?.BffClaimAccepted == true;
        if (accepted)
        {
            logger.LogInformation("bff.check: the API accepts this console's client address claims");
        }
        else
        {
            logger.LogWarning("bff.check: the API ignored this console's client address claim; check Network:BffAddress on the API " +
                "and that both sides use the same Network:BffSharedKey. Until then every administrator shares one rate-limit bucket");
        }

        return accepted;
    }
}

/// <summary>Runs <see cref="BffSelfCheck"/> once after startup, retrying while the API is not reachable yet.</summary>
public sealed class BffStartupCheck(BffSelfCheck check, ILogger<BffStartupCheck> logger) : BackgroundService
{
    public static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(10);
    public const int Attempts = 6;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!check.Configured)
        {
            return;
        }

        for (var attempt = 1; attempt <= Attempts && !stoppingToken.IsCancellationRequested; attempt++)
        {
            try
            {
                await check.CheckAsync(stoppingToken);
                return;
            }
            catch (Exception exception) when ((exception is HttpRequestException or TaskCanceledException) && !stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning("bff.check: the API did not answer (attempt {Attempt} of {Attempts}, {Failure})",
                    attempt, Attempts, exception.GetType().Name);
            }

            try
            {
                await Task.Delay(RetryDelay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
