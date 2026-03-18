using System.Diagnostics;
using System.Diagnostics.Metrics;

namespace Nop.Core.Infrastructure
{
    public static class NopTelemetry
    {
        public static readonly ActivitySource ActivitySource = new("Nop.Commerce.OrderFlow");

        public static readonly Meter Meter = new("Nop.Commerce.Metrics");
        

        //1: Valor total das encomendas
        public static readonly Counter<double> OrderValueCounter = 
            Meter.CreateCounter<double>("nop_order_value_total", "Euros", "Valor total das encomendas processadas");

        //2: Duração da validação de stock
        public static readonly Histogram<double> StockValidationDuration = 
            Meter.CreateHistogram<double>("nop_stock_validation_duration", "ms", "Tempo gasto na validação de stock");
    }
}