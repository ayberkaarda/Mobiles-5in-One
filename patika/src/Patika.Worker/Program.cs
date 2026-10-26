using Patika.Worker;

var builder = Host.CreateApplicationBuilder(args);
builder.AddPatikaWorker();
await builder.Build().RunAsync();
