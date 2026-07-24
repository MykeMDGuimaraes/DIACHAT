/**
 * Fixtures negativas da fronteira core <-> messaging.
 *
 * Cria arquivos temporarios que VIOLAM as regras do dependency-cruiser e
 * garante que cada violacao e detectada. Se alguma fixture passar sem erro,
 * a fronteira esta furada e o script falha.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const backendRoot = path.resolve(__dirname, "..");
const depcruiseBin = process.env.DEPCRUISE_BIN
  ? path.resolve(process.env.DEPCRUISE_BIN)
  : path.join(backendRoot, "node_modules", ".bin", "depcruise");

if (!fs.existsSync(depcruiseBin)) {
  console.error(
    `depcruise nao encontrado em ${depcruiseBin}. Instale dependency-cruiser ou defina DEPCRUISE_BIN.`
  );
  process.exit(1);
}

const fixtures = [
  {
    name: "core importando internals de messaging",
    file: "src/__boundaryFixtureCore.ts",
    content:
      'import MessageCommand from "./messaging/persistence/models/MessageCommand";\nexport default MessageCommand;\n',
    expectedRule: "core-nao-importa-internals-de-messaging"
  },
  {
    name: "messaging importando core fora da allowlist",
    file: "src/messaging/__boundaryFixtureMessaging.ts",
    content:
      'import CreateService from "../services/UserServices/CreateUserService";\nexport default CreateService;\n',
    expectedRule: "messaging-so-importa-core-da-allowlist"
  },
  {
    name: "database importando runtime de messaging",
    file: "src/database/__boundaryFixtureDatabase.ts",
    content:
      'import { startMessagingRuntime } from "../messaging/public/runtime";\nexport default startMessagingRuntime;\n',
    expectedRule: "sequelize-init-so-importa-models-de-messaging"
  }
];

let failures = 0;

for (const fixture of fixtures) {
  const absolute = path.join(backendRoot, fixture.file);
  fs.writeFileSync(absolute, fixture.content);
  try {
    let output = "";
    try {
      output = execFileSync(
        depcruiseBin,
        [fixture.file, "--config", ".dependency-cruiser.js"],
        {
          cwd: backendRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
    } catch (error) {
      output = `${error.stdout || ""}${error.stderr || ""}`;
    }
    if (output.includes(fixture.expectedRule)) {
      console.log(`ok: ${fixture.name} detectada (${fixture.expectedRule})`);
    } else {
      console.error(
        `FALHA: fixture "${fixture.name}" NAO disparou a regra ${fixture.expectedRule}`
      );
      failures += 1;
    }
  } finally {
    fs.unlinkSync(absolute);
  }
}

if (failures > 0) {
  process.exit(1);
}
console.log("Todas as fixtures negativas de fronteira foram detectadas.");
