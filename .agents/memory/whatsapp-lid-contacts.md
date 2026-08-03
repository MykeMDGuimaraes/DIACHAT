---
name: Contatos WhatsApp @lid (correlação de identidade)
description: Flag BAILEYS_LID_CORRELATION_ENABLED controla uso do remoteJidAlt; sem ela contatos @lid ficam sem número e a ingestão pode quebrar
---

WhatsApp substituiu JIDs de telefone por `@lid` em muitas conversas. O Baileys entrega o telefone real em `key.remoteJidAlt` (ou `participantAlt` em grupos), mas o backend só o usa quando `BAILEYS_LID_CORRELATION_ENABLED=true` (verifyContact em wbotMessageListener). Sem a flag: contato fica com `number=null`, `jidServer=lid` e o número nunca é preenchido.

Segunda armadilha: `resolveContactJid` lança `CONTACT_WHATSAPP_IDENTITY_UNAVAILABLE` quando o objeto contato não tem nem number nem lid — acontece quando o contato vem de um include do Sequelize com `attributes` limitados (sem `lid`/`jidServer`), mesmo que o banco tenha os valores. Isso derrubava o `provider` ANTES de salvar a mensagem: contato+ticket criados, mensagem perdida (catch amplo do handleMessage só loga).

Terceira armadilha (confirmada com evento real capturado em dev, ago/2026): o Baileys atual entrega o telefone do remetente @lid em **`key.senderPn`** — muitos eventos NÃO trazem `remoteJidAlt`. O código que lia só remoteJidAlt/participantAlt deixava number nulo mesmo com a flag ligada. `getContactMessage` agora faz fallback `remoteJidAlt || senderPn` (e `participantAlt || senderPn` em grupos).

Quarta armadilha: o senderPn vem SEM o nono dígito brasileiro em algumas regiões (`553190610568`), mas quem disca/importa informa COM (`5531990610568`) — o WhatsApp aceita e entrega nas duas formas. A busca exata por `number` não casava e duplicava contato+ticket. Hoje a identidade de contato busca por **ambas as formas** (helper `brazilianNinthDigitVariants`, só não-grupo).

Quinta armadilha (a mais cara): existem **dois caminhos de envio por API** — o legado `/api/messages/send` (MessageController → CreateOrUpdateContactService) e o novo `/api/v1/messages` (PublicTextMessageService, com busca de contato PRÓPRIA e exata). Corrigir um não corrige o outro. Para saber qual o cliente usa: AuditLog `legacy_messages_send_accessed` (legado) vs `messaging."MessageCommands"` (novo). Toda correção de identidade de contato precisa cobrir os dois lados.

Sexta observação (ago/2026): `messages.upsert` NÃO dispara para mensagens enviadas pelo próprio socket Baileys (envios pela tela ou por API) — só para o que o servidor do WhatsApp empurra (recebidas, ou fromMe enviadas do app do celular pareado). Log de evento baseado em upsert (WA_RAW_EVENT) portanto não serve para verificar envios; para isso, conferir a tabela Messages. Bônus: ids de mensagem são texto hex/uuid — ordenar por `createdAt`, nunca por id.

**Why:** incidente em produção (ago/2026): contato criado sem número, conversa sem mensagens; causa raiz = include limitado + flag de correlação desligada.

**How to apply:** (1) manter `BAILEYS_LID_CORRELATION_ENABLED=true` no app/backend/.env; (2) qualquer include de Contact usado em fluxos de mensagem precisa incluir `lid` e `jidServer` nos attributes — ou usar o contato fresco do verifyContact; (3) CreateOrUpdateContactService preenche number ausente quando um evento posterior traz o telefone (busca por lid primeiro), então contatos legados @lid se autocorrigem na próxima mensagem recebida.
