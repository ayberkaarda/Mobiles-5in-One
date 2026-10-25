using System.Security.Cryptography;
using System.Text;

namespace Patika.Api.Security.Passwords;

/// <summary>Checks a candidate password against a breach corpus.</summary>
public interface IBreachedPasswordChecker
{
    Task<bool> IsBreachedAsync(string password, CancellationToken cancellationToken);
}

/// <summary>
/// Have I Been Pwned range API with k-anonymity: only the first five hex characters of the SHA-1
/// digest leave the process, and response padding is requested. The check fails open (logs a
/// warning and allows the password) when the service is unreachable, so registration stays available.
/// </summary>
public sealed class HibpBreachedPasswordChecker(HttpClient http, ILogger<HibpBreachedPasswordChecker> logger)
    : IBreachedPasswordChecker
{
    public const string HttpClientName = "hibp";

    public async Task<bool> IsBreachedAsync(string password, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(password);
        var (prefix, suffix) = Split(password);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"range/{prefix}");
            request.Headers.Add("Add-Padding", "true");
            using var response = await http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Breached password lookup returned {StatusCode}; allowing", (int)response.StatusCode);
                return false;
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            return ContainsSuffix(body, suffix);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException
            && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Breached password lookup unavailable ({ErrorType}); allowing", exception.GetType().Name);
            return false;
        }
    }

    internal static (string Prefix, string Suffix) Split(string password)
    {
        var digest = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(password)));
        return (digest[..5], digest[5..]);
    }

    internal static bool ContainsSuffix(string body, string suffix)
    {
        foreach (var rawLine in body.Split('\n'))
        {
            var line = rawLine.TrimEnd('\r');
            var separator = line.IndexOf(':', StringComparison.Ordinal);
            if (separator != suffix.Length)
            {
                continue;
            }

            if (string.Equals(line[..separator], suffix, StringComparison.OrdinalIgnoreCase)
                && long.TryParse(line[(separator + 1)..], out var count) && count > 0)
            {
                return true;
            }
        }

        return false;
    }
}
