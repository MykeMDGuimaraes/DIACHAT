# Rollout de identidade PN/LID

## Flags e versões

- Produção inicial: Baileys vendorizado `6.7.24`.
- `BAILEYS_LID_CORRELATION_ENABLED=false` por padrão.
- A flag controla apenas a associação automática dos campos alternativos PN/LID.
  O reconhecimento e o envio para um JID primário `@lid` permanecem ativos.
- A ativação da correlação exige uma versão Baileys 7 homologada que exponha
  `remoteJidAlt`, `participantAlt` e `WAMessageAddressingMode`.

## Backfill

1. Aplicar a migration de identidades de contato.
2. Executar `npm run build` no backend.
3. Executar `npm run backfill:contact-lids` sem `--apply` e guardar apenas o
   resumo sem PII.
4. Investigar `collisions` por IDs internos. O job não mescla contatos.
5. Com backup confirmado, executar
   `npm run backfill:contact-lids -- --apply --after-id=0 --batch-size=200`.
6. Em caso de interrupção, retomar com o último `lastContactId` emitido.

## Homologação obrigatória

- Reconectar sessão existente sem novo QR.
- Conectar sessão nova por QR.
- Receber e responder mensagens PN, LID e grupo.
- Enviar texto, mídia, botões, presença, reações, edição e exclusão.
- Confirmar que `Contacts.number` nunca recebe o local-part de `@lid`.
- Confirmar ausência de telefone e LID em logs, métricas e relatórios.

## Rollback

- Desligar `BAILEYS_LID_CORRELATION_ENABLED` antes de reverter a aplicação.
- As colunas novas permanecem aplicadas.
- Nunca restaurar `Contact.number` com um LID nem executar merge automático.
