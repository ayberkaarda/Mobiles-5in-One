#:property PublishAot=false
// Local stand-in for Google Pub/Sub push in the Destekçi demo (docs/demo/destekci.md).
// It owns a throwaway RSA key, publishes it as a JWKS and posts DeveloperNotification messages with an
// OIDC-style bearer signed by that key. The API trusts it only because the demo points Billing:Rtdn:JwksUrl here.
//
//   dotnet run docs/demo/rtdn-local.cs -- serve <dir> <port>
//   dotnet run docs/demo/rtdn-local.cs -- send <dir> <webhookUrl> <audience> <email> <purchaseToken> <notificationType>
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

if (args.Length < 2)
{
    Console.Error.WriteLine("usage: serve <dir> <port> | send <dir> <webhookUrl> <audience> <email> <purchaseToken> <notificationType>");
    return 2;
}

var dir = Directory.CreateDirectory(args[1]).FullName;
var keyPath = Path.Combine(dir, "push-key.pem");
using var rsa = RSA.Create(2048);
if (File.Exists(keyPath)) rsa.ImportFromPem(File.ReadAllText(keyPath));
else File.WriteAllText(keyPath, rsa.ExportRSAPrivateKeyPem());
var publicKey = rsa.ExportParameters(false);
var kid = B64(SHA256.HashData(publicKey.Modulus!))[..16];

if (args[0] == "serve" && args.Length == 3)
{
    var jwks = JsonSerializer.Serialize(new
    {
        keys = new[] { new { kty = "RSA", alg = "RS256", use = "sig", kid, n = B64(publicKey.Modulus!), e = B64(publicKey.Exponent!) } },
    });
    // Loopback TCP keeps it reachable as host.docker.internal or 10.0.2.2 without an HTTP.sys URL reservation.
    var listener = new TcpListener(IPAddress.Loopback, int.Parse(args[2], System.Globalization.CultureInfo.InvariantCulture));
    listener.Start();
    Console.WriteLine($"JWKS kid {kid} on http://127.0.0.1:{args[2]}/jwks.json");
    while (true)
    {
        using var client = await listener.AcceptTcpClientAsync();
        await using var stream = client.GetStream();
        var buffer = new byte[4096];
        _ = await stream.ReadAsync(buffer);
        var body = Encoding.UTF8.GetBytes(jwks);
        var head = Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(head);
        await stream.WriteAsync(body);
        Console.WriteLine($"{DateTimeOffset.Now:HH:mm:ss} served JWKS");
    }
}

if (args[0] == "send" && args.Length == 7)
{
    var (url, audience, email, purchaseToken, type) = (args[2], args[3], args[4], args[5], int.Parse(args[6], System.Globalization.CultureInfo.InvariantCulture));
    var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    var header = B64(JsonSerializer.SerializeToUtf8Bytes(new { alg = "RS256", typ = "JWT", kid }));
    var claims = B64(JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object>
    {
        ["iss"] = "https://accounts.google.com", ["aud"] = audience, ["email"] = email, ["email_verified"] = true,
        ["sub"] = "local-push", ["iat"] = now, ["exp"] = now + 300,
    }));
    var signature = B64(rsa.SignData(Encoding.ASCII.GetBytes(header + "." + claims), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
    var notification = new
    {
        version = "1.0", packageName = "app.patika.android", eventTimeMillis = (now * 1000).ToString(System.Globalization.CultureInfo.InvariantCulture),
        subscriptionNotification = new { version = "1.0", notificationType = type, purchaseToken },
    };
    var envelope = new
    {
        message = new { messageId = Guid.NewGuid().ToString(), data = Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(notification)) },
        subscription = "projects/local/subscriptions/patika-play",
    };
    using var http = new HttpClient();
    using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent(envelope) };
    request.Headers.Authorization = new("Bearer", $"{header}.{claims}.{signature}");
    using var response = await http.SendAsync(request);
    Console.WriteLine($"POST {url} type {type} -> {(int)response.StatusCode}");
    return response.IsSuccessStatusCode ? 0 : 1;
}

Console.Error.WriteLine("unknown command");
return 2;

static string B64(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

static StringContent JsonContent(object value) => new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");
