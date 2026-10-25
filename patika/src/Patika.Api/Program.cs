using Patika.Api;
using Patika.Api.Features.Auth;
using Patika.Api.Features.Health;
using Patika.Api.Features.Me;
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

app.Run();

public partial class Program { }
