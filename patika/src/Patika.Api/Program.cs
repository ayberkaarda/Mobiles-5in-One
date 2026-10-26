using Microsoft.EntityFrameworkCore;
using Patika.Api;
using Patika.Api.Features.Account;
using Patika.Api.Features.Admin;
using Patika.Api.Features.Adoptions;
using Patika.Api.Features.Animals;
using Patika.Api.Features.Auth;
using Patika.Api.Features.CarePlaces;
using Patika.Api.Features.Devices;
using Patika.Api.Features.Health;
using Patika.Api.Features.Me;
using Patika.Api.Features.Media;
using Patika.Api.Features.Reports;
using Patika.Api.Features.Stations;
using Patika.Api.Features.Subscriptions;
using Patika.Api.Features.Urgent;
using Patika.Api.Idempotency;
using Patika.Api.OpenApi;
using Patika.Infrastructure;
using Patika.Infrastructure.Billing;
using Patika.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.AddPatikaApi();
builder.Services.AddPlayBilling(builder.Configuration, builder.Environment.IsDevelopment(), builder.Environment.IsProduction());
builder.Services.AddHttpClient("play-push");
builder.Services.AddSingleton(sp => new PlayPushVerifier(sp.GetRequiredService<IHttpClientFactory>().CreateClient("play-push"), builder.Configuration, sp.GetRequiredService<TimeProvider>()));
builder.Services.AddPatikaInfrastructure(builder.Configuration.GetConnectionString("Patika"));

var app = builder.Build();

// Development and compose only; production runs migrations as a separate step.
if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<PatikaDbContext>().Database.MigrateAsync();
}

app.UsePatikaApi();
app.MapHealth();
var v1 = app.MapGroup("/v1");
v1.MapHealth();
v1.MapAuth();
v1.MapTotp();
v1.MapAdmin();
v1.MapMe();
v1.MapSubscriptions();
app.MapPlayPush();
v1.MapAccount();
// Create endpoints accept an Idempotency-Key; auth, token and upload routes stay outside this group.
var idempotent = v1.MapGroup(string.Empty).WithIdempotency();
idempotent.MapStationEndpoints();
idempotent.MapAnimalEndpoints();
idempotent.MapAdoptionEndpoints();
v1.MapCarePlaceEndpoints();
idempotent.MapReportEndpoints();
v1.MapMediaEndpoints();
idempotent.MapUrgentEndpoints();
v1.MapDeviceEndpoints();
app.MapPatikaOpenApi();

app.Run();

public partial class Program { }
