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
const depcruiseCli = process.env.DEPCRUISE_BIN
  ? path.resolve(process.env.DEPCRUISE_BIN)
  : path.join(
      backendRoot,
      "node_modules",
      "dependency-cruiser",
      "bin",
      "dependency-cruise.mjs"
    );

if (!fs.existsSync(depcruiseCli)) {
  console.error(
    `depcruise nao encontrado em ${depcruiseCli}. Instale dependency-cruiser ou defina DEPCRUISE_BIN.`
  );
  process.exit(1);
}

const fixtures = [
  {
    name: "core importando internals de messaging",
    files: {
      "src/__boundaryFixtureCore.ts":
        'import MessageCommand from "./messaging/persistence/models/MessageCommand";\nexport default MessageCommand;\n'
    },
    expectedRule: "core-nao-importa-internals-de-messaging"
  },
  {
    name: "messaging importando core fora da allowlist",
    files: {
      "src/messaging/__boundaryFixtureMessaging.ts":
        'import CreateService from "../services/UserServices/CreateUserService";\nexport default CreateService;\n'
    },
    expectedRule: "messaging-so-importa-core-da-allowlist"
  },
  {
    name: "database importando runtime de messaging",
    files: {
      "src/database/__boundaryFixtureDatabase.ts":
        'import { startMessagingRuntime } from "../messaging/public/runtime";\nexport default startMessagingRuntime;\n'
    },
    expectedRule: "sequelize-init-so-importa-models-de-messaging"
  },
  {
    name: "core importando Baileys diretamente",
    files: {
      "src/__boundaryFixtureDirectBaileys.ts":
        'import makeWASocket from "baileys";\nexport default makeWASocket;\n'
    },
    expectedRule: "baileys-somente-no-adapter"
  },
  {
    name: "fachada publica participando de ciclo",
    files: {
      "src/messaging/public/__boundaryFixturePublicCycle.ts":
        'import coreCycle from "../../__boundaryFixtureCoreCycle";\nexport default coreCycle;\n',
      "src/__boundaryFixtureCoreCycle.ts":
        'import publicCycle from "./messaging/public/__boundaryFixturePublicCycle";\nexport default publicCycle;\n'
    },
    expectedRule: "messaging-public-sem-ciclos"
  }
];

let failures = 0;

for (const fixture of fixtures) {
  const fixtureFiles = Object.entries(fixture.files);
  const absoluteFiles = fixtureFiles.map(([file]) =>
    path.join(backendRoot, file)
  );
  fixtureFiles.forEach(([file, content]) => {
    fs.writeFileSync(path.join(backendRoot, file), content);
  });
  try {
    let output = "";
    try {
      output = execFileSync(
        process.execPath,
        [
          depcruiseCli,
          ...Object.keys(fixture.files),
          "--config",
          ".dependency-cruiser.js"
        ],
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
    absoluteFiles.forEach(absolute => fs.unlinkSync(absolute));
  }
}

if (failures > 0) {
  process.exit(1);
}
console.log("Todas as fixtures negativas de fronteira foram detectadas.");
