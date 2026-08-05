/**
 * Fronteira estrutural core <-> messaging (Messaging v1).
 *
 * Regras:
 * - O core so pode importar do modulo de mensageria pelas fachadas
 *   `src/messaging/public/*` (excecao unica: o init do Sequelize em
 *   `src/database` registra os models de mensageria).
 * - O modulo de mensageria so pode importar do core os itens da allowlist.
 */
const MESSAGING_ALLOWED_CORE_TARGETS = [
  "^src/database",
  "^src/errors/AppError",
  "^src/config/upload",
  "^src/utils/logger",
  "^src/helpers/GetTicketWbot",
  "^src/helpers/brazilianNinthDigitVariants",
  "^src/libs/wbot",
  "^src/models/(AuditLog|Company|Contact|Message|Ticket|TicketTraking|Whatsapp|Queue|User|Setting)(\\.ts)?$",
  "^src/services/MessageServices/CreateMessageService",
  "^src/services/WhatsappService/CreateWhatsAppService"
];

module.exports = {
  forbidden: [
    {
      name: "baileys-somente-no-adapter",
      severity: "error",
      comment:
        "Dependencias diretas de Baileys pertencem exclusivamente ao adapter de mensageria",
      from: {
        pathNot: ["^src/messaging/adapters/baileys(?:/|$)"]
      },
      to: {
        path: "(?:^|/)node_modules/(?:@adiwajshing/)?baileys(?:/|$)|^(?:@adiwajshing/)?baileys(?:/|$)"
      }
    },
    {
      name: "messaging-public-sem-ciclos",
      severity: "error",
      comment:
        "Fachadas publicas de mensageria nao podem participar de dependencias circulares",
      from: { path: "^src/messaging/public(?:/|$)" },
      to: { circular: true }
    },
    {
      name: "core-nao-importa-internals-de-messaging",
      severity: "error",
      comment:
        "O core deve consumir mensageria apenas pelas fachadas src/messaging/public/*",
      from: {
        path: "^src",
        pathNot: ["^src/messaging", "^src/database"]
      },
      to: {
        path: "^src/messaging",
        pathNot: ["^src/messaging/public"]
      }
    },
    {
      name: "sequelize-init-so-importa-models-de-messaging",
      severity: "error",
      comment:
        "src/database so pode importar models de persistencia de messaging",
      from: { path: "^src/database" },
      to: {
        path: "^src/messaging",
        pathNot: ["^src/messaging/persistence/models"]
      }
    },
    {
      name: "messaging-so-importa-core-da-allowlist",
      severity: "error",
      comment:
        "O modulo de mensageria so pode depender do core pelos itens da allowlist",
      from: { path: "^src/messaging", pathNot: ["\\.spec\\.ts$", "__tests__"] },
      to: {
        path: "^src",
        pathNot: ["^src/messaging"].concat(MESSAGING_ALLOWED_CORE_TARGETS)
      }
    }
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: {
      path: ["\\.spec\\.ts$", "__tests__", "\\.d\\.ts$"]
    }
  }
};
