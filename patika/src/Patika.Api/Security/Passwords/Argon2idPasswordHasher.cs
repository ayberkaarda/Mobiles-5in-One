using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Konscious.Security.Cryptography;

namespace Patika.Api.Security.Passwords;

public interface IPasswordHasher
{
    Task<string> HashAsync(string password, CancellationToken cancellationToken);

    /// <summary>
    /// Verifies a password. A <c>null</c> hash (external-login-only account or unknown user) still
    /// runs a full hash so that response time does not reveal whether the account exists.
    /// </summary>
    Task<bool> VerifyAsync(string password, string? encodedHash, CancellationToken cancellationToken);
}

/// <summary>
/// Argon2id with m=65536 KiB, t=3, p=1, a 16-byte salt and a 32-byte tag, stored in the PHC string
/// format <c>$argon2id$v=19$m=65536,t=3,p=1$salt$tag</c>.
/// </summary>
public sealed class Argon2idPasswordHasher : IPasswordHasher
{
    public const int MemoryKiB = 65536;
    public const int Iterations = 3;
    public const int Parallelism = 1;
    public const int SaltBytes = 16;
    public const int TagBytes = 32;
    private const string Prefix = "$argon2id$v=19$";

    // Upper bounds protect against a tampered stored hash forcing an expensive computation.
    private const int MaxMemoryKiB = 262144;
    private const int MaxIterations = 10;
    private const int MaxParallelism = 4;

    private readonly Lazy<string> dummyHash;

    public Argon2idPasswordHasher()
    {
        dummyHash = new Lazy<string>(
            () =>
            {
                var salt = RandomNumberGenerator.GetBytes(SaltBytes);
                var tag = Compute(Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)), salt,
                    MemoryKiB, Iterations, Parallelism);
                return Encode(salt, MemoryKiB, Iterations, Parallelism, tag);
            },
            LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public Task<string> HashAsync(string password, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(password);
        return Task.Run(() =>
        {
            var salt = RandomNumberGenerator.GetBytes(SaltBytes);
            var tag = Compute(password, salt, MemoryKiB, Iterations, Parallelism);
            return Encode(salt, MemoryKiB, Iterations, Parallelism, tag);
        }, cancellationToken);
    }

    public Task<bool> VerifyAsync(string password, string? encodedHash, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(password);
        return Task.Run(() =>
        {
            var useDummy = encodedHash is null || !TryDecode(encodedHash, out _, out _, out _, out _, out _);
            var hash = useDummy ? dummyHash.Value : encodedHash!;
            if (!TryDecode(hash, out var memory, out var iterations, out var parallelism, out var salt, out var expected))
            {
                return false;
            }

            var actual = Compute(password, salt, memory, iterations, parallelism, expected.Length);
            var matches = CryptographicOperations.FixedTimeEquals(actual, expected);
            return matches && !useDummy;
        }, cancellationToken);
    }

    public static bool NeedsRehash(string encodedHash) =>
        !TryDecode(encodedHash, out var memory, out var iterations, out var parallelism, out var salt, out var tag)
        || memory != MemoryKiB || iterations != Iterations || parallelism != Parallelism
        || salt.Length != SaltBytes || tag.Length != TagBytes;

    internal static bool TryDecode(
        string encoded, out int memory, out int iterations, out int parallelism, out byte[] salt, out byte[] tag)
    {
        memory = iterations = parallelism = 0;
        salt = tag = [];
        if (!encoded.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return false;
        }

        var parts = encoded[Prefix.Length..].Split('$');
        if (parts.Length != 3)
        {
            return false;
        }

        foreach (var pair in parts[0].Split(','))
        {
            var kv = pair.Split('=');
            if (kv.Length != 2 || !int.TryParse(kv[1], NumberStyles.None, CultureInfo.InvariantCulture, out var value))
            {
                return false;
            }

            switch (kv[0])
            {
                case "m": memory = value; break;
                case "t": iterations = value; break;
                case "p": parallelism = value; break;
                default: return false;
            }
        }

        if (memory is < 8 or > MaxMemoryKiB || iterations is < 1 or > MaxIterations
            || parallelism is < 1 or > MaxParallelism)
        {
            return false;
        }

        try
        {
            salt = FromBase64NoPadding(parts[1]);
            tag = FromBase64NoPadding(parts[2]);
        }
        catch (FormatException)
        {
            return false;
        }

        return salt.Length >= 8 && tag.Length >= 16;
    }

    private static byte[] Compute(string password, byte[] salt, int memory, int iterations, int parallelism, int length = TagBytes)
    {
        var bytes = Encoding.UTF8.GetBytes(password);
        try
        {
            using var argon = new Argon2id(bytes)
            {
                Salt = salt,
                MemorySize = memory,
                Iterations = iterations,
                DegreeOfParallelism = parallelism,
            };
            return argon.GetBytes(length);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
        }
    }

    private static string Encode(byte[] salt, int memory, int iterations, int parallelism, byte[] tag) =>
        string.Create(CultureInfo.InvariantCulture,
            $"{Prefix}m={memory},t={iterations},p={parallelism}${ToBase64NoPadding(salt)}${ToBase64NoPadding(tag)}");

    private static string ToBase64NoPadding(byte[] value) => Convert.ToBase64String(value).TrimEnd('=');

    private static byte[] FromBase64NoPadding(string value)
    {
        var padded = value.Length % 4 == 0 ? value : value + new string('=', 4 - (value.Length % 4));
        return Convert.FromBase64String(padded);
    }
}
