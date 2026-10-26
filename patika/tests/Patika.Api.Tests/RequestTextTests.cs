using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using Patika.Api.Tests.Infrastructure;
using Patika.Api.Validation;
using Patika.Contracts;
using Patika.Contracts.Admin;
using Patika.Contracts.Auth;
using Xunit;
using static Patika.Api.Tests.Infrastructure.ApiTestClient;

namespace Patika.Api.Tests;

public sealed class RequestTextTests
{
    private const string Dirty = "a\u202Eb\U000E0001c\r\nd";
    private const string Clean = "abc d";

    private static IEnumerable<Type> RequestContracts() => typeof(VerbatimAttribute).Assembly.GetTypes()
        .Where(t => t.IsClass && !t.IsAbstract && t.IsPublic && (t.Name.EndsWith("Request", StringComparison.Ordinal)
            || t.Name.EndsWith("Query", StringComparison.Ordinal)));

    [Fact]
    public void OnlyPasswordsAndOpaqueTokensAreVerbatim()
    {
        var verbatim = RequestContracts()
            .SelectMany(t => t.GetProperties().Where(p => p.GetCustomAttribute<VerbatimAttribute>() is not null)
                .Select(p => $"{t.Name}.{p.Name}"))
            .Order(StringComparer.Ordinal)
            .ToArray();

        // Adding to this list needs a reason: everything else a client sends is cleaned.
        Assert.Equal(
        [
            "GoogleSignInRequest.IdToken",
            "LinkExternalLoginRequest.IdToken",
            "LoginRequest.Password",
            "LogoutRequest.RefreshToken",
            "MfaRequest.MfaToken",
            "RefreshRequest.RefreshToken",
            "RegisterDeviceRequest.Token",
            "RegisterRequest.Password",
            "ResetPasswordRequest.NewPassword",
            "UnregisterDeviceRequest.Token",
            "VerifySubscriptionRequest.PurchaseToken",
        ], verbatim);
    }

    [Fact]
    public void EveryOtherStringOfEveryRequestContractIsCleanedWhateverItsName()
    {
        var checkedProperties = 0;
        foreach (var type in RequestContracts())
        {
            var instance = RuntimeHelpers.GetUninitializedObject(type);
            var strings = type.GetProperties().Where(p => p.PropertyType == typeof(string) && p.CanWrite).ToArray();
            foreach (var property in strings) property.SetValue(instance, Dirty);

            RequestText.Clean(instance);

            foreach (var property in strings)
            {
                var expected = property.GetCustomAttribute<VerbatimAttribute>() is null ? Clean : Dirty;
                Assert.True(expected == (string?)property.GetValue(instance), $"{type.Name}.{property.Name}");
                checkedProperties++;
            }
        }

        Assert.True(checkedProperties > 40, $"only {checkedProperties} string properties found");
    }

    [Fact]
    public async Task TheFilterCleansEveryContractArgumentAndLeavesOthersAlone()
    {
        var request = new AdminUnsuspendRequest(Dirty);
        var other = new Holder { Name = Dirty };
        var context = new Microsoft.AspNetCore.Http.DefaultEndpointFilterInvocationContext(new Microsoft.AspNetCore.Http.DefaultHttpContext(), request, other, Dirty);
        object? seen = null;

        await new RequestTextFilter().InvokeAsync(context, c =>
        {
            seen = c.Arguments[0];
            return ValueTask.FromResult<object?>(null);
        });

        Assert.Equal(Clean, ((AdminUnsuspendRequest)seen!).Reason);
        Assert.Equal(Dirty, other.Name);
    }

    [Fact]
    public async Task RegistrationThroughThePipelineStoresTheCleanedNameAndTheExactPassword()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient("198.51.100.70");
        var email = NewEmail("temiz");
        const string password = "uzun-ve-guclu-sifre-\u202E-77";

        using var response = await client.PostRegisterAsync(email, password, "Mahalle\u202E\U000E0001 Gönüllüsü");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var user = Assert.Single(factory.Store.Users);
        Assert.Equal("Mahalle Gönüllüsü", user.DisplayName);
        using var verified = await client.VerifyEmailAsync(email, factory.Outbox.VerificationCodeFor(email));
        using var login = await client.LoginAsync(email, password);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        using var cleanedPassword = await client.LoginAsync(email, "uzun-ve-guclu-sifre--77");
        Assert.Equal(HttpStatusCode.Unauthorized, cleanedPassword.StatusCode);
    }

    private sealed class Holder
    {
        public string? Name { get; set; }
    }
}
