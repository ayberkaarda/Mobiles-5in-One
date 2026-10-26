using System.Net;
using Patika.Api.Tests.Infrastructure;
using Xunit;

namespace Patika.Api.Tests.OpenApi;

/// <summary>The API description is not served by default outside Development; a scan run turns it on explicitly.</summary>
public sealed class OpenApiExposureTests
{
    [Fact]
    public async Task OutsideDevelopmentTheDocumentIsNotServedByDefault()
    {
        await using var factory = new PatikaApiFactory();
        using var client = factory.CreateApiClient();

        using var response = await client.GetAsync("/openapi.json", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task OpenApiEnabledServesTheDocument()
    {
        await using var factory = new PatikaApiFactory();
        factory.Settings["OpenApi:Enabled"] = "true";
        using var client = factory.CreateApiClient();

        using var response = await client.GetAsync("/openapi.json", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.Contains("\"/v1/auth/login\"", body, StringComparison.Ordinal);
    }
}
