using Patika.Api;
using Patika.Api.Features.Account;
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
using Patika.Api.Features.Urgent;
using Patika.Api.OpenApi;
using Patika.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.AddPatikaApi();
builder.Services.AddPatikaInfrastructure(builder.Configuration.GetConnectionString("Patika"));

var app = builder.Build();

app.UsePatikaApi();
app.MapHealth();
var v1 = app.MapGroup("/v1");
v1.MapHealth();
v1.MapAuth();
v1.MapMe();
v1.MapAccount();
v1.MapStationEndpoints();
v1.MapAnimalEndpoints();
v1.MapAdoptionEndpoints();
v1.MapCarePlaceEndpoints();
v1.MapReportEndpoints();
v1.MapMediaEndpoints();
v1.MapUrgentEndpoints();
v1.MapDeviceEndpoints();
app.MapPatikaOpenApi();

app.Run();

public partial class Program { }
