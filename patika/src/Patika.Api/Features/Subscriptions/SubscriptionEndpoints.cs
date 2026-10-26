using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Patika.Api.Security.Authorization;
using Patika.Contracts.Subscriptions;
using Patika.Domain.Entities;
using Patika.Infrastructure.Billing;
using Patika.Infrastructure.Persistence;

namespace Patika.Api.Features.Subscriptions;

public static class SubscriptionEndpoints
{
    public static IEndpointRouteBuilder MapSubscriptions(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/subscriptions/verify", async (VerifySubscriptionRequest request, HttpContext http, SubscriptionService service,
            BillingAccountIds accounts, CancellationToken ct) =>
        {
            var userId = ActorFactory.FromPrincipal(http.User).UserId;
            if (userId is null) return Results.Unauthorized();
            try
            {
                var entitlement = await service.VerifyAsync(userId.Value, accounts.For(userId.Value), request, ct);
                return Results.Ok(entitlement with { BillingAccountId = accounts.For(userId.Value) });
            }
            catch (PurchaseRejectedException e)
            {
                return Results.Problem(statusCode: e.Code == "purchase_owned_elsewhere" ? 409 : 400,
                    title: "Satın alma doğrulanamadı.", extensions: new Dictionary<string, object?> { ["code"] = e.Code });
            }
        }).RequireAuthorization().RequireRateLimiting("subscriptions");
        endpoints.MapGet("/me/entitlement", async (HttpContext http, SubscriptionService service, BillingAccountIds accounts, CancellationToken ct) =>
            ActorFactory.FromPrincipal(http.User).UserId is { } id
                ? Results.Ok(await service.EntitlementAsync(id, ct) with { BillingAccountId = accounts.For(id) })
                : Results.Unauthorized()).RequireAuthorization();
        return endpoints;
    }

    public static void MapPlayPush(this WebApplication app)
    {
        app.MapPost("/webhooks/play", PushAsync).AllowAnonymous();
        if (app.Environment.IsDevelopment() && (app.Configuration["Billing:Provider"] ?? "Fake") == "Fake")
        {
            app.MapPost("/dev/billing/purchases", async (FakePurchaseRequest request, FakePlayDeveloperApi fake, CancellationToken ct) =>
            {
                if (request.BasePlanId is not ("aylik" or "yillik") || request.ObfuscatedAccountId is { Length: > 64 }) return Results.BadRequest();
                var token = Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
                var purchase = new PlaySubscription([new(BillingTokens.Product,
                    DateTimeOffset.UtcNow.AddDays(request.BasePlanId == "aylik" ? 30 : 365), new(true), new(request.BasePlanId))],
                    "SUBSCRIPTION_STATE_ACTIVE", "ACKNOWLEDGEMENT_STATE_PENDING", TestPurchase: JsonSerializer.SerializeToElement(new { }),
                    // Play keeps the account id the app passed to the billing flow; the simulated store does the same.
                    ExternalAccountIdentifiers: new(request.ObfuscatedAccountId));
                await fake.SeedAsync(BillingTokens.Package, token, purchase, ct);
                return Results.Ok(new FakePurchaseResponse(token));
            }).RequireAuthorization().RequireRateLimiting("subscriptions");
        }
    }

    private static async Task<IResult> PushAsync(HttpContext http, PlayPushVerifier verifier, PatikaDbContext db, CancellationToken ct)
    {
        const int limit = 65536;
        if (http.Request.ContentLength > limit) return Results.StatusCode(413);
        if (!await verifier.VerifyAsync(http.Request.Headers.Authorization, ct)) return Results.Unauthorized();
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int read;
        while ((read = await http.Request.Body.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > limit) return Results.StatusCode(413);
            buffer.Write(chunk, 0, read);
        }
        try
        {
            using var envelope = JsonDocument.Parse(buffer.ToArray());
            var message = envelope.RootElement.GetProperty("message");
            var id = message.GetProperty("messageId").GetString();
            if (string.IsNullOrWhiteSpace(id) || id.Length > 255) return Results.BadRequest();
            if (await db.PlayNotifications.AnyAsync(x => x.MessageId == id, ct)) return Results.Ok();
            var bytes = Convert.FromBase64String(message.GetProperty("data").GetString()!);
            using var payload = JsonDocument.Parse(bytes);
            var root = payload.RootElement;
            if (root.GetProperty("packageName").GetString() != BillingTokens.Package) return Results.NoContent();
            string? token = null;
            string type;
            // Only a subscription token is re-read from Play; every other kind is stored as handled and acknowledged.
            var ignored = true;
            if (root.TryGetProperty("subscriptionNotification", out var notification))
            {
                token = notification.GetProperty("purchaseToken").GetString();
                type = notification.GetProperty("notificationType").GetInt32().ToString(System.Globalization.CultureInfo.InvariantCulture);
                ignored = false;
            }
            else if (root.TryGetProperty("voidedPurchaseNotification", out var voided))
            {
                // A voided subscription (refund or chargeback) is refreshed like any other change; productType 1 is a subscription.
                type = "voided";
                if (voided.TryGetProperty("productType", out var kind) && kind.GetInt32() == 1)
                {
                    token = voided.GetProperty("purchaseToken").GetString();
                    ignored = false;
                }
            }
            else if (root.TryGetProperty("oneTimeProductNotification", out _)) type = "one_time";
            else if (root.TryGetProperty("testNotification", out _)) type = "test";
            else return Results.BadRequest();
            if (!ignored && (string.IsNullOrWhiteSpace(token) || token.Length > 4096)) return Results.BadRequest();
            var now = DateTimeOffset.UtcNow;
            var eventAt = root.TryGetProperty("eventTimeMillis", out var timestamp)
                ? DateTimeOffset.FromUnixTimeMilliseconds(long.Parse(timestamp.GetString()!, System.Globalization.CultureInfo.InvariantCulture)) : now;
            db.PlayNotifications.Add(new PlayNotification
            {
                MessageId = id,
                Type = type,
                PayloadHash = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(bytes)),
                PurchaseTokenHash = token is null ? null : BillingTokens.Hash(token),
                EventAt = eventAt,
                ReceivedAt = now,
                ProcessedAt = ignored ? now : null
            });
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" }) { return Results.Ok(); }
            return Results.NoContent();
        }
        catch (Exception e) when (e is JsonException or FormatException or KeyNotFoundException or InvalidOperationException or ArgumentException or OverflowException)
        { return Results.BadRequest(); }
    }
}
