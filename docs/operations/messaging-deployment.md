# Deploy e operação da mensageria V1

## Secrets obrigatórios

```text
DATABASE_URL=postgresql://...?...sslmode=require
API_KEY_PEPPER=<aleatório, estável e fora do banco>
MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER=<aleatório, estável>
MESSAGING_ENCRYPTION_ACTIVE_KEY_ID=v1
MESSAGING_ENCRYPTION_KEY_V1=<32 bytes em base64>
META_GRAPH_VERSION=v23.0
BACKEND_URL=https://dominio-publico
FRONTEND_URL=https://dominio-publico
JWT_SECRET=<mínimo 32 bytes>
JWT_REFRESH_SECRET=<mínimo 32 bytes e diferente do JWT_SECRET>
```

## API pública Baileys — Fase 1

As migrations `20260730000000` e `20260730000001` são aditivas. Execute-as com a mesma `DATABASE_URL` de staging antes de ativar qualquer flag:

```bash
cd app/backend
npx sequelize db:migrate
```

As capacidades são desligadas por padrão e devem ser habilitadas apenas na empresa de homologação, nesta ordem: `MESSAGING_INTERNAL_TEMPLATES_V1_ENABLED`, `MESSAGING_MEDIA_UPLOAD_V1_ENABLED`, `MESSAGING_PRESENCE_V1_ENABLED` e `MESSAGING_REACTIONS_V1_ENABLED`. O upload multipart fica em `storage/messaging` (fora de `/public`); garanta volume persistente e backup criptografado desse diretório.

Antes do corte, use uma credencial nova com os scopes mínimos necessários e uma conexão Baileys controlada para validar: texto idempotente, mídia multipart, template interno, presença, reação, edição, exclusão, URL assinada de mídia e reconexão sem duplicação. Não habilite as flags de empresas de clientes até a conclusão dessa prova.

`META_GRAPH_VERSION` é fallback da plataforma e nunca pode ser `latest`; cada canal também persiste a versão validada pela empresa. Configure `META_GRAPH_SUNSET_AT` para que `/internal/v1/messaging/metrics` alerte nos 90 dias anteriores ao sunset.

O processo executa `DeploymentPreflight` antes de Redis e migrations. A publicação é recusada quando `DATABASE_URL` não é PostgreSQL com transporte TLS (`sslmode=require` ou `DB_SSL=true`), a origem não usa HTTPS, um segredo obrigatório está ausente, a chave AES não decodifica para 32 bytes ou `RUN_SEEDS=true` não possui `PRODUCTION_SEED_CONFIRMATION=I_UNDERSTAND`.

## Ordem do deploy

1. Faça backup do PostgreSQL e confirme os secrets.
2. Execute as migrations Sequelize antes de iniciar o novo código.
3. Inicie uma única instância da aplicação; não permita duas sessões Baileys para o mesmo número.
4. Confira `GET /health/live`, `GET /health/ready` e `GET /internal/v1/messaging/metrics` com credencial de serviço.
5. Em staging, execute o capacity gate com 20 conexões reais por 30 minutos; não promova se qualquer gate falhar.
6. Valide um envio idempotente e um webhook HMAC em uma empresa controlada.
7. Faça canário com uma empresa Meta, acompanhando idade da outbox/inbox, dead-letter, leases expirados, RSS e pool PostgreSQL.
8. Só então habilite gradualmente os canais Meta das demais empresas.

Redis pode ser apagado/reiniciado sem perda de comandos de mensageria. Os reconciliadores recuperam leases vencidos do PostgreSQL. Um comando que estava em `sending` vira `unknown` e não é reenviado automaticamente.

O capacity gate e o canário usam conexões e credenciais reais configuradas pelas próprias empresas. Não há provider mock no runtime; os segredos são inseridos pelo wizard do frontend, validados na Meta e armazenados cifrados.

## Rotação da chave de dados

Adicione a nova `MESSAGING_ENCRYPTION_KEY_V2`, mantenha a V1 disponível para descriptografia e altere `MESSAGING_ENCRYPTION_ACTIVE_KEY_ID=v2`. Novos segredos e rotações passam a usar V2; deliveries existentes continuam usando o snapshot e `keyVersion` gravados. Remova V1 somente depois que métricas/consulta confirmarem que nenhuma credencial, assinatura ou delivery retido ainda a referencia.

## Rollback

O rollback do código não deve desfazer migrations destrutivamente. Mantenha migrations expansivas e código anterior tolerante às colunas novas. Antes de devolver ownership de uma sessão Baileys, drene a fila, encerre o socket com graceful shutdown e preserve o estado autenticado mais recente.

## Retenção e deprecação

O job redige payloads terminais após 30 dias e remove registros terminais após 180 dias. Resultado, falha e idade do último sucesso aparecem nas métricas. O endpoint legado anuncia o successor por 30–60 dias e somente retorna `410` após o sunset e 14 dias sem chamadas relevantes para a empresa.
