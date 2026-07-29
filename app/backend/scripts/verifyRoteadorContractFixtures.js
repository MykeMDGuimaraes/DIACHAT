const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

require("ts-node/register/transpile-only");

const {
  adaptBaileysMessageEvents,
  adaptBaileysChatUpdate,
  adaptBaileysConnectionUpdate
} = require("../src/messaging/adapters/baileys/BaileysProviderEventAdapter");
const {
  adaptMetaMessageEvents,
  adaptMetaChatUpdate,
  adaptMetaConnectionUpdate
} = require("../src/messaging/adapters/meta-cloud/MetaProviderEventAdapter");
const WhatsAppMirrorProjectionService =
  require("../src/messaging/webhooks/WhatsAppMirrorProjectionService").default;

const roteadorRoot =
  process.env.ROTEADOR_ROOT ||
  path.resolve(__dirname, "../../../../../..", "Roteador");
const fixtureRoot = path.resolve(__dirname, "../fixtures/whatsapp-mirror");
const repositoryPython =
  process.platform === "win32"
    ? path.join(roteadorRoot, ".venv", "Scripts", "python.exe")
    : path.join(roteadorRoot, ".venv", "bin", "python");
const python =
  process.env.PYTHON ||
  (fs.existsSync(repositoryPython) ? repositoryPython : "python");

const context = {
  companyId: 7,
  whatsappId: 3,
  conversationId: "fixture-conversation",
  contactId: "fixture-contact",
  externalTicketId: "fixture-ticket",
  automationEpoch: 3
};
const observedAt = new Date("2026-01-01T00:00:00.000Z");

const adaptFixtureEvent = (fixture, item) => {
  const input = { ...context, raw: item.raw, observedAt };
  if (fixture.provider === "baileys") {
    if (item.adapter === "message") return adaptBaileysMessageEvents(input);
    return [
      item.adapter === "chat"
        ? adaptBaileysChatUpdate(input)
        : adaptBaileysConnectionUpdate(input)
    ];
  }
  if (item.adapter === "message") return adaptMetaMessageEvents(input);
  return [
    item.adapter === "chat"
      ? adaptMetaChatUpdate(input)
      : adaptMetaConnectionUpdate(input)
  ];
};

const generateRealEnvelopes = async () => {
  const projection = new WhatsAppMirrorProjectionService({
    loadMessage: async () => null,
    projectMedia: async () => null,
    now: () => observedAt
  });
  const files = fs
    .readdirSync(fixtureRoot)
    .filter(fileName => fileName.endsWith("-rich.json"))
    .sort();
  if (!files.length) throw new Error("no contract fixtures found");
  const generated = [];
  for (const fileName of files) {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, fileName), "utf8")
    );
    const events = fixture.events.flatMap(item =>
      adaptFixtureEvent(fixture, item)
    );
    for (const [index, event] of events.entries()) {
      const snapshot = await projection.buildSnapshot({
        id: `fixture-${fileName}-${index}`,
        companyId: event.companyId,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        createdAt: event.occurredAt,
        leaseToken: "fixture-lease"
      });
      generated.push({
        fixture: fileName,
        eventType: event.eventType,
        envelope: snapshot.envelope
      });
    }
  }
  return generated;
};

const program = [
  "import json, pathlib, sys",
  "root = pathlib.Path(sys.argv[1]).resolve()",
  "sys.path.insert(0, str(root))",
  "from app.services.dia_chat_webhook import parse_dia_chat_webhook",
  "generated = json.load(sys.stdin)",
  "failures = []",
  "for item in generated:",
  "    try:",
  "        parse_dia_chat_webhook(item['envelope'])",
  "    except Exception as exc:",
  "        failures.append({'fixture': item['fixture'], 'eventType': item['eventType'], 'error': str(exc)[:1000]})",
  "report = {'gate': 'roteador-external-contract', 'compatible': not failures, 'activationBlocked': bool(failures), 'generatedBy': 'real-adapter-plus-WhatsAppMirrorProjectionService', 'envelopes': len(generated), 'incompatibilities': failures}",
  "print(json.dumps(report, ensure_ascii=False))",
  "raise SystemExit(2 if failures else 0)"
].join("\n");

const verify = async () => {
  const envelopes = await generateRealEnvelopes();
  const result = spawnSync(python, ["-c", program, roteadorRoot], {
    cwd: roteadorRoot,
    encoding: "utf8",
    input: JSON.stringify(envelopes),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.status || 1;
  }
  return result.status;
};

if (require.main === module) {
  verify().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { adaptFixtureEvent, generateRealEnvelopes, verify };
