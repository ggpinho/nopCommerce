using System.Diagnostics;
using System.Diagnostics.Metrics;

namespace Nop.Core.Infrastructure
{
    public static class NopTelemetry
    {
        public static readonly ActivitySource ActivitySource = new("Nop.Commerce.OrderFlow");

        public static readonly Meter Meter = new("Nop.Commerce.Metrics");
        

        public static readonly Counter<double> OrderValueCounter = 
            Meter.CreateCounter<double>("nop_order_value_total", "Euros", "Valor total das encomendas processadas");

        public static readonly Counter<long> OrderCounter =
            Meter.CreateCounter<long>("nop_orders_total", "Orders", "Total de encomendas processadas");

        public static readonly Counter<long> OrderFailureCounter =
            Meter.CreateCounter<long>("nop_orders_failed_total", "Orders", "Total de encomendas falhadas");

        public static readonly Histogram<double> StockValidationDuration = 
            Meter.CreateHistogram<double>("nop_stock_validation_duration", "ms", "Tempo gasto na validação de stock");

        public static readonly Histogram<double> CheckoutStepDuration =
            Meter.CreateHistogram<double>("nop_checkout_step_duration", "ms", "Tempo gasto por etapa do checkout");

        public static readonly Histogram<double> PaymentGatewayDuration =
            Meter.CreateHistogram<double>("nop_payment_gateway_duration", "ms", "Tempo de resposta do gateway de pagamento");
    }
}