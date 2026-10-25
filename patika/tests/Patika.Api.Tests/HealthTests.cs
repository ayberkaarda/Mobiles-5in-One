using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Patika.Contracts.Dto;
using Patika.Contracts.Errors;
using Xunit;

namespace Patika.Api.Tests;

public sealed class HealthTests
{
    [Theory]
    [InlineData("/health")]
    [InlineData("/v1/health")]
    public async Task HealthReturnsOkWithoutDatabase(string path)
    {
        await using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseSetting(
                "ConnectionStrings:Patika", "Host=127.0.0.1;Database=patika;Timeout=1"));
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        var body = await response.Content.ReadFromJsonAsync<HealthResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.NotNull(body);
        Assert.Equal("ok", body.Status);
    }

    [Fact]
    public async Task UnknownRouteReturnsProblemDetails()
    {
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/v1/unknown", TestContext.Current.CancellationToken);
        var problem = await response.Content.ReadFromJsonAsync<ApiProblemDetails>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.NotNull(problem);
        Assert.Equal("http_404", problem.Code);
        Assert.False(string.IsNullOrWhiteSpace(problem.TraceId));
    }
}
