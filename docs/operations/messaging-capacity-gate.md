# Capacity gate de mensageria

Este gate não cria sessões, não usa provider mock e não envia mensagens. Ele exige exatamente 20 conexões reais já ativas e exerce o caminho HTTP, autenticação de serviço, PostgreSQL, métricas e orçamento de memória a 50 req/s.

No backend do ambiente de teste:

```text
MESSAGING_CAPACITY_PROBE_ENABLED=true
```

Na máquina que executa o teste:

```text
MESSAGING_CAPACITY_RUN=1
CAPACITY_TARGET_URL=https://seu-diachat
CAPACITY_SERVICE_TOKEN=<tokenId.secret>
CAPACITY_CONNECTION_IDS=1,2,...,20
CAPACITY_RPS=50
CAPACITY_DURATION_SECONDS=1800
```

Execute `npm run capacity:messaging` em `app/backend`. O relatório versionável é gravado em `app/backend/artifacts/capacity/`.

Gates padrão:

- zero falhas HTTP;
- p95 até 250 ms;
- RSS máximo até 6,5 GB, preservando margem na VM de 8 GB;
- idade máxima da outbox até 30 s.

O probe fica desabilitado por padrão e exige credencial de serviço. Para medir entrega real de providers, use números de teste controlados por cada empresa e um roteiro operacional separado; o harness deliberadamente não dispara mensagens para clientes.
