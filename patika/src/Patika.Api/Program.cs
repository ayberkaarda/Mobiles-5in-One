using System.Diagnostics;
using Patika.Api.Features.Health;
using Patika.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = context =>
    {
        context.ProblemDetails.Extensions["traceId"] =
            Activity.Current?.Id ?? context.HttpContext.TraceIdentifier;
        context.ProblemDetails.Extensions["code"] =
            $"http_{context.ProblemDetails.Status ?? StatusCodes.Status500InternalServerError}";
    };
});
builder.Services.AddPatikaInfrastructure(builder.Configuration.GetConnectionString("Patika"));

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();
app.MapHealth();
var v1 = app.MapGroup("/v1");
v1.MapHealth();

app.Run();

public partial class Program { }
