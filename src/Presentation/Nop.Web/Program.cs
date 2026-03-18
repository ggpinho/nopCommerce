    using Autofac.Extensions.DependencyInjection;
    using Nop.Core.Configuration;
    using Nop.Core.Infrastructure;
    using Nop.Web.Framework.Infrastructure.Extensions;
    using OpenTelemetry;
    using OpenTelemetry.Trace;
    using OpenTelemetry.Metrics;
    using OpenTelemetry.Resources;

    namespace Nop.Web;

    public partial class Program
    {
        public static async Task Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            builder.Configuration.AddJsonFile(NopConfigurationDefaults.AppSettingsFilePath, true, true);
            if (!string.IsNullOrEmpty(builder.Environment?.EnvironmentName))
            {
                var path = string.Format(NopConfigurationDefaults.AppSettingsEnvironmentFilePath, builder.Environment.EnvironmentName);
                builder.Configuration.AddJsonFile(path, true, true);
            }
            builder.Configuration.AddEnvironmentVariables();

            //load application settings
            builder.Services.ConfigureApplicationSettings(builder);

            var appSettings = Singleton<AppSettings>.Instance;
            var useAutofac = appSettings.Get<CommonConfig>().UseAutofac;

            if (useAutofac)
                builder.Host.UseServiceProviderFactory(new AutofacServiceProviderFactory());
            else
            {
                builder.Host.UseDefaultServiceProvider(options =>
                {
                    options.ValidateScopes = false;
                    options.ValidateOnBuild = true;
                });
            }

        // -------------------------------
        // OpenTelemetry configuration
        // -------------------------------

        builder.Services.AddOpenTelemetry()
            .ConfigureResource(resource => resource.AddService("NopCommerce-Web"))
            .WithTracing(tracing =>
            {
                tracing
                    .AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation()
                    .AddSqlClientInstrumentation()
                    .AddSource(NopTelemetry.ActivitySource.Name) 
                    .AddOtlpExporter(options =>
                    {
                        options.Endpoint = new Uri("http://localhost:4317");
                    });
            })
            .WithMetrics(metricsProviderBuilder =>
            {
                metricsProviderBuilder
                    .AddAspNetCoreInstrumentation()
                    .AddRuntimeInstrumentation()
                    .AddMeter(NopTelemetry.Meter.Name) 
                    .AddOtlpExporter(options =>
                    {
                        options.Endpoint = new Uri("http://localhost:4317");
                    });
            });

            builder.Services.ConfigureApplicationServices(builder);

            var app = builder.Build();

            app.ConfigureRequestPipeline();
            await app.PublishAppStartedEventAsync();

            await app.RunAsync();
        }
    }