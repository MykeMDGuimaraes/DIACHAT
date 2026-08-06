# Evidência de homologação — WhatsApp Delivery Hardening (T9)

- **Data**: 2026-08-06
- **SHA base**: `9b8b178` (branch `main`) — inclui T1–T8 merged; T9 adiciona
  o mecanismo de coorte de rollout (seção 3.4)
- **Ambiente**: Repl de desenvolvimento, PostgreSQL **16.10**, Node 20

## 1. Bateria completa

| Verificação | Resultado |
| --- | --- |
| Backend `tsc` build | ✅ limpo |
| Backend suíte completa | ✅ **152 suites / 759 testes** |
| Backend lint (arquivos do hardening: `src/messaging/**`, `wbot.ts`, `WbotServices/Baileys*`, `SessionManager*`, `helpers/authState*`, migrações T9) | ✅ 0 erros (drift zero; erros de formatação pré-existentes no restante do repo são cobertos pela tarefa de lint #42) |
| `depcruise` (arquitetura) | ✅ 0 violações (794 módulos, 2539 dependências) |
| `check:messaging-boundaries` | ✅ válidas |
| `check:boundary-fixtures` (fixtures negativas) | ✅ todas detectadas |
| Frontend testes (`CI=true react-scripts test`) | ✅ 2 suites / 5 testes |
| Frontend build de produção (`GENERATE_SOURCEMAP=false`, heap 2560MB, dev server parado) | ✅ exit 0 |

## 2. Migrações (apply → rollback → reapply, PostgreSQL 16.10)

Todas revertidas (`db:migrate:undo`) e reaplicadas (`db:migrate`), com
verificação de ausência/presença dos objetos a cada etapa:

| Migração | rollback | reapply |
| --- | --- | --- |
| `20260804000000-create-whatsapp-session-leases` | ✅ tabela removida | ✅ recriada |
| `20260805000000-add-delivery-health-to-whatsapps` | ✅ coluna removida | ✅ recriada |
| `20260805000001-create-whatsapp-session-keys` | ✅ tabela removida | ✅ recriada |
| `20260806000000-create-messaging-rollout-cohorts` | ✅ tabela+índice removidos | ✅ recriados |

`SequelizeMeta` confirma as quatro como as mais recentes aplicadas após o
reapply. Sem perda de dados (tabelas vazias em dev; em produção o rollback
destrutivo não é prática — ver plano de rollout).

## 3. Homologação de concorrência

| Cenário | Evidência | Resultado |
| --- | --- | --- |
| Boot + dez conectares simultâneos → um socket e um QR | `WhatsAppSessionManager.spec.ts` (concorrência de replace/claim, fencing por geração) | ✅ suite verde |
| Duas réplicas → uma lease e um fencingToken vigente | `WhatsAppSessionLeaseRepository.spec.ts` + spec da migração `20260804000000` (banco real) | ✅ 2 suites / 10 testes |
| Três restarts → uma sessão por boot | 3 restarts ao vivo do workflow Backend: cada boot com exatamente 1 `Server started on port: 3001`, 0 linhas `ERROR`/`duplicate`; sessões sem credencial ignoradas 1× por empresa | ✅ |

### 3.4 Coorte de rollout por empresa (auth store) — implementado na T9

A revisão de código apontou que o canário por faixas não era executável com
`MESSAGING_AUTH_STORE_MODE` global por processo. Solução implementada e
verificada:

- Tabela `messaging."MessagingRolloutCohorts"` (capability, companyId, mode)
  com índice único por (capability, empresa) — migração idempotente com
  guards `to_regclass`/`describeTable`.
- `resolveAuthStoreModeForCompany(companyId)`: coorte persistida vence o
  default global; cache de 60s por empresa; qualquer falha (DB, migração
  pendente, modo desconhecido, companyId ausente) cai no modo global — nunca
  quebra o boot. `authState` resolve por empresa na criação do socket.
- Specs (banco real + migração mockada): 2 suites / 8 testes — modo por
  empresa, fallback global, modo inválido → fallback, companyId ausente →
  fallback, cache/TTL/flush, capacidades independentes, apply/repair/no-op da
  migração.
- Operação documentada com SQL exato (selecionar, observar, promover e
  reverter faixas) em `docs/operations/hardening-t9-rollout.md` e query de
  diagnóstico no runbook.

## 4. Homologação funcional (provider fake / banco real)

| Cenário | Evidência | Resultado |
| --- | --- | --- |
| Envio com ACK ≥ 2 e sem duplicata de eco | `BaileysDomainEventService.spec.ts` (advance por ACK) + pipelines T3–T5 | ✅ |
| Ausência de ACK → `unknown` em 5 min; canal degradado na 2ª ocorrência; sem resend/restart | `ChannelDeliveryHealthService.spec.ts` + `BaileysDomainEventService.spec.ts` | ✅ |
| ACK tardio → recuperação do `unknown` | `BaileysDomainEventService.spec.ts` | ✅ |
| 408/428/515 → uma reconexão | `BaileysDisconnectPolicy.spec.ts` | ✅ |
| 401/403/440/463 → sem loop de reconexão | `BaileysDisconnectPolicy.spec.ts` | ✅ |
| Lanes: 100 comandos em ordem, 2 canais independentes, corrida de 2 workers → 1 claim por canal | `MessageCommandDispatcherLanes.integration.spec.ts` (banco real, advisory lock) | ✅ |

Suites de homologação executadas nesta rodada: 9 suites / 114 testes (além da
suíte completa de 759).

### Pendente do usuário (canal real — não automatizável no Repl)

- Escanear QR de um **canal controlado** e repetir com tráfego real: texto,
  resposta citada e lote de três mídias com ACK ≥ 2 e sem duplicata de eco;
  boot + dez conectares simultâneos observando um único QR (follow-up #67).
- Acompanhar o **canário de 24h** do canal interno antes de ampliar faixas
  (follow-up #68).

## 5. Decisão

**GO condicional.** Todas as verificações automatizáveis estão verdes
(bateria completa, migrações, concorrência, funcional com provider fake,
restarts ao vivo) e o rollout por faixas é operacionalmente executável via
coorte persistida por empresa (sem deploy para mover faixas). A decisão
final de publish depende dos dois itens com canal real listados acima —
recomendado concluí-los antes do deploy (o publish é decisão do usuário,
fora do escopo T9).

## 6. Referências

- Plano de rollout por flags/coortes: `docs/operations/hardening-t9-rollout.md`
- Runbook operacional: `docs/operations/whatsapp-delivery-runbook.md`
- Deploy/migrations/preflight: `docs/operations/messaging-deployment.md`
