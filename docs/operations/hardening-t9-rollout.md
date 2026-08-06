# Rollout gradual — WhatsApp Delivery Hardening (T9)

Plano de ativação das capacidades do hardening em produção, por flag/coorte,
com gates de promoção e caminho de rollback de cada uma. **Nenhuma etapa
avança sem o gate anterior verde.** Decisão de publish: usuário (fora do
escopo T9).

## Inventário de capacidades e como se ligam/desligam

| Capacidade | Origem | Controle | Rollback |
| --- | --- | --- | --- |
| Session manager (fencing, lease, um socket por canal) | T2 | Estrutural — sempre ativo desde o merge; não há flag | Reverter o commit da T2 com fila drenada e sockets encerrados (graceful shutdown) |
| Unified outbox (comandos, dispatcher, lanes T8) | T3/T8 | Estrutural — sempre ativo; paralelismo ajustável via `MESSAGING_DISPATCH_CHANNEL_CONCURRENCY` (padrão 8, máx 64) | Reverter commits T3/T8; reduzir concorrência para 1 em caso de contenção |
| Delivery UI (saúde de entrega do canal no painel) | T4/T5 | Estrutural — sempre ativa no frontend | Reverter commit T4/T5 (apenas UI; sem risco de dados) |
| Postgres auth store (chaves/credenciais cifradas) | T6/T9 | **Coorte por empresa** em `messaging."MessagingRolloutCohorts"` (`capability='auth_store'`, `mode` ∈ `json`/`dual_write`/`postgres`); sem row vale o default global `MESSAGING_AUTH_STORE_MODE` | Por empresa: voltar o `mode` da coorte (ou apagar a row → default global), **somente dentro da janela de 7 dias** do modo `postgres` e com comparação de revisão por canal antes da volta |

Flags auxiliares já existentes (não ligar em massa): capacidades V1
(`MESSAGING_PRESENCE_V1_ENABLED`, `MESSAGING_REACTIONS_V1_ENABLED`,
`MESSAGING_INTERNAL_TEMPLATES_V1_ENABLED`, `MESSAGING_MEDIA_UPLOAD_V1_ENABLED`)
— por empresa, só após prova controlada conforme `messaging-deployment.md`.

## Operação de coortes (auth store)

A coorte é persistida — mudança por SQL, sem deploy. Efeito em até **60s**
(cache por empresa) e vale na **próxima criação/reconexão de socket** daquele
canal (sockets já abertos mantêm o modo até reconectar).

```sql
-- Ativar dual_write para a empresa do canal interno (canário):
INSERT INTO messaging."MessagingRolloutCohorts"
  (capability, "companyId", mode, "createdAt", "updatedAt")
VALUES ('auth_store', :companyId, 'dual_write', NOW(), NOW())
ON CONFLICT (capability, "companyId")
DO UPDATE SET mode = EXCLUDED.mode, "updatedAt" = NOW();

-- Promover a empresa para postgres (leitura/escrita no store cifrado):
UPDATE messaging."MessagingRolloutCohorts"
SET mode = 'postgres', "updatedAt" = NOW()
WHERE capability = 'auth_store' AND "companyId" = :companyId;

-- Rollback de uma empresa (dentro da janela de 7 dias, após comparar
-- revisões do canal — ver seção Rollback):
UPDATE messaging."MessagingRolloutCohorts"
SET mode = 'dual_write', "updatedAt" = NOW()
WHERE capability = 'auth_store' AND "companyId" = :companyId;

-- Voltar a empresa ao default global (remove a coorte):
DELETE FROM messaging."MessagingRolloutCohorts"
WHERE capability = 'auth_store' AND "companyId" = :companyId;

-- Observar as faixas ativas:
SELECT mode, COUNT(*) AS empresas
FROM messaging."MessagingRolloutCohorts"
WHERE capability = 'auth_store'
GROUP BY mode;
```

## Sequência de ativação

1. **Pré-corte**: backup do PostgreSQL; migrations aplicadas
   (`20260804000000`, `20260805000000`, `20260805000001`, `20260806000000`);
   secrets do preflight confirmados; `MESSAGING_AUTH_STORE_MODE=json`
   (default global) e **nenhuma row de coorte**.
2. **Código novo no ar** — o sistema sobe idêntico ao comportamento anterior
   (todas as empresas no default `json`), já com session manager/outbox
   ativos.
3. **Canário — 1 canal interno, 24h**: backfill dry-run
   (`npm run backfill:whatsapp-session-keys`), inserir coorte `dual_write`
   só para a empresa interna, forçar uma reconexão do canal e acompanhar as
   métricas do runbook (`deliverySignals`). Promovê-la a `postgres` após gate
   verde.
4. **10% das empresas** → **50%** → **100%**: inserir coortes por faixa
   (`dual_write` → `postgres` por empresa), sempre após gate verde na faixa
   anterior (mínimo 24h em cada faixa de 10%/50%).
5. **Default global por último**: com ~100% em coorte `postgres`, alterar
   `MESSAGING_AUTH_STORE_MODE=postgres` no ambiente e ir removendo rows de
   coorte (empresas sem row seguem o global).
6. **Janela de 7 dias em `postgres` (100%)**: só depois dela, remover a
   coluna legada `Whatsapp.session` (tarefa fora de escopo, agendada
   separadamente).

## Gates de promoção (por faixa)

Verificar no endpoint de métricas (`deliverySignals`) e nos logs
`delivery-alert`, por faixa, antes de avançar:

- `duplicate_active_socket` = 0 (qualquer ocorrência = bloqueio, ver runbook).
- `auth_revision_conflict_total` estável por empresa da faixa (crescimento
  contínuo = investigar escritores concorrentes antes de avançar).
- `auth_write_failure_total` = 0 na janela da faixa.
- `delivery_unconfirmed_threshold` sem novos disparos atribuíveis ao corte
  (sessões degradadas pré-existentes seguem o procedimento do runbook).
- `send_pipeline_provider_id_to_ack_ms` p95 dentro do baseline do ambiente.
- Leases: um `ownerId`/`fencingToken` vigente por canal
  (`messaging."WhatsAppSessionLeases"`).

Qualquer gate vermelho: **parar a expansão**, manter a faixa atual e seguir o
runbook. Não há rollback automático.

## Rollback por capacidade

- **Auth store (rollback por coorte, sem deploy)**: dentro da janela de 7
  dias do modo `postgres` da empresa, comparar revisões por canal
  (`MAX(revision)` em `messaging."WhatsAppSessionKeys"` vs. estado legado) e
  só então voltar o `mode` da coorte para `dual_write` ou remover a row
  (volta ao default global). Nunca voltar sem a comparação — escrita com
  revisão não crescente é bloqueada pelo fencing e derruba o canal (política
  de falha persistente).
- **Session manager / outbox / delivery UI**: rollback = revert dos commits
  correspondentes com deploy normal; drenar a fila de envio e encerrar
  sockets com graceful shutdown antes de devolver o ownership das sessões.
- **Migrations**: não desfazer destrutivamente em produção (ver
  `messaging-deployment.md` — migrations expansivas, código anterior
  tolerante às colunas novas).
