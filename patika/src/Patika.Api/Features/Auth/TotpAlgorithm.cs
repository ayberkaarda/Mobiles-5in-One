using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Patika.Api.Features.Auth;

public static class TotpAlgorithm
{
    public static string Code(ReadOnlySpan<byte> secret, long step, int digits = 6)
    {
        Span<byte> counter = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(counter, step);
        var hash = HMACSHA1.HashData(secret, counter);
        var offset = hash[^1] & 15;
        var value = BinaryPrimitives.ReadUInt32BigEndian(hash.AsSpan(offset, 4)) & 0x7fffffff;
        return (value % (digits == 8 ? 100_000_000u : 1_000_000u)).ToString(digits == 8 ? "D8" : "D6", CultureInfo.InvariantCulture);
    }

    public static long? Match(ReadOnlySpan<byte> secret, string? code, DateTimeOffset now, long lastStep)
    {
        if (code is not { Length: 6 } || !code.All(char.IsAsciiDigit)) return null;
        var supplied = Encoding.ASCII.GetBytes(code);
        var current = now.ToUnixTimeSeconds() / 30;
        long? match = null;
        for (var step = current - 1; step <= current + 1; step++)
        {
            var equal = CryptographicOperations.FixedTimeEquals(supplied, Encoding.ASCII.GetBytes(Code(secret, step)));
            if (equal && step > lastStep) match = step;
        }
        return match;
    }

    public static string Base32(ReadOnlySpan<byte> bytes)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var result = new StringBuilder();
        var buffer = 0;
        var bits = 0;
        foreach (var value in bytes)
        {
            buffer = (buffer << 8) | value;
            bits += 8;
            while (bits >= 5) { bits -= 5; result.Append(alphabet[(buffer >> bits) & 31]); }
        }
        if (bits > 0) result.Append(alphabet[(buffer << (5 - bits)) & 31]);
        return result.ToString();
    }
}
