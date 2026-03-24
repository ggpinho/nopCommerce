## 1. O que ajudou e o que dificultou a instrumentação

### Ajudou
A arquitetura em camadas foi uma vantagem clara. Como a camada Core não tem dependências das camadas superiores, pude colocar as definições de telemetria em Nop.Core.Infrastructure sem criar dependências circulares. Isto permitiu que qualquer camada emitisse sinais sem interferir com as regras arquiteturais.

O OrderProcessingService também se revelou um ponto natural de instrumentação. O método PlaceOrder concentra toda a lógica de checkout, desde a validação ao pagamento e persistência, tornando-o ideal para adicionar traces com alterações mínimas.

### Dificultou
Apesar de estar bem organizado, o código é grande e complexo. Vários métodos são muito extensos, o que dificultou a identificação dos pontos exatos onde os spans deviam começar e terminar.

O sistema de eventos (IEventPublisher) criou dificuldades porque os eventos são assíncronos e perdem o contexto do pedido original. Isto impede seguir o fluxo completo da execução (causalidade) sem propagar manualmente o Activity, algo que não está implementado.

Posto isto, optei por instrumentar apenas o fluxo síncrono dentro de PlaceOrder. Esta abordagem reduz a visibilidade sobre eventos assíncronos, mas garante simplicidade, consistência e menor risco.
---

## 2. O que mudaria para tornar o sistema mais observável

Se pudesse tomar decisões arquiteturais para versões futuras do nopCommerce, introduziria três alterações:

- Tornar o ActivitySource injetável (em vez de estático), para melhorar testabilidade e flexibilidade.

- Propagar automaticamente o contexto de trace no IEventPublisher, permitindo seguir o fluxo mesmo em eventos assíncronos
.
- Criar uma abstração para métricas (ex: IMetricRecorder), desacoplando o código do OpenTelemetry.

### Custo

- Tempo de desenvolvimento: Implementar a injeção do ActivitySource e a propagação de contexto nos eventos exige alterações em vários pontos do sistema (configuração, serviços e event pipeline). 

- Complexidade adicional no código:  A introdução de abstrações (como IMetricRecorder) e propagação de contexto aumenta o número de componentes e a lógica interna, tornando o sistema ligeiramente mais difícil de manter e compreender.

- Compatibilidade:  É necessário garantir que as alterações funcionam com código existente.

---

## 3. Alterações cirúrgicas – onde, porquê e como minimizei o impacto

### Onde fiz as alterações
As mudanças cirúrgicas foram feitas em três ficheiros:

- Nop.Core/Infrastructure/NopTelemetry.cs – centralização de ActivitySource, Meter e métricas.
- Nop.Services/Orders/OrderProcessingService.cs – adição de spans (OrderFlow.PlaceOrderProcess, OrderFlow.PaymentGatewayStep, OrderFlow.SaveDatabaseStep) e registo de métricas no fluxo PlaceOrder.
- Nop.Web/Program.cs – configuração dos exporters OpenTelemetry (OTLP) e adição do meter personalizado.

### Porquê estes locais
Os pontos instrumentados foram escolhidos porque concentram os eventos associados "Customer places an order", pagamento, persistência, validação de stock e não existiam hooks prontos para capturar essa informação de forma nativa. O fluxo de PlaceOrder é o coração do processo de encomenda; instrumentá-lo diretamente garante que capturamos a latência e os erros onde acontecem, sem depender de eventos assíncronos que perdem contexto.

### Como minimizei o impacto
Para garantir que as alterações não introduzissem riscos ou alterações de comportamento, segui três princípios:

- **Alterações aditivas** – Nunca modifiquei a lógica de negócio existente. Apenas adicionei blocos `using var activity` e registo de métricas em pontos onde não interferem com o fluxo normal.

- **Uso de finally para métricas críticas** – No caso da validação de stock, coloquei o registo do histogram num bloco `finally` para garantir que a métrica é sempre registada, mesmo em caso de exceção, sem alterar o controlo de erros.

- **Tags focadas em dados não sensíveis** – Emiti apenas `customer.id`, `payment.method`, `order.total` e `error.type`. Evitei qualquer campo que pudesse conter PII (email, morada, dados de cartão). Isto garante que a telemetria é segura por design, não por configuração externa.

---

Com esta abordagem, consegui adicionar observabilidade a um fluxo crítico da aplicação preservando a integridade do código original.
