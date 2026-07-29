const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

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
const program = [
  "import json, pathlib, sys",
  "root = pathlib.Path(sys.argv[1]).resolve()",
  "fixtures = pathlib.Path(sys.argv[2]).resolve()",
  "sys.path.insert(0, str(root))",
  "from app.services.dia_chat_webhook import parse_dia_chat_webhook",
  "parsed = 0",
  "files = sorted(fixtures.glob('*-rich.json'))",
  "assert files, 'no contract fixtures found'",
  "for fixture_path in files:",
  "    fixture = json.loads(fixture_path.read_text(encoding='utf-8'))",
  "    for envelope in fixture['roteadorEnvelopes']:",
  "        parse_dia_chat_webhook(envelope)",
  "        parsed += 1",
  "print(json.dumps({'parser': 'Roteador.app.services.dia_chat_webhook', 'fixtures': len(files), 'envelopes': parsed}))"
].join("\n");

const result = spawnSync(python, ["-c", program, roteadorRoot, fixtureRoot], {
  cwd: roteadorRoot,
  encoding: "utf8",
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.status !== 0) {
  process.stderr.write(
    result.stderr || "Roteador contract verification failed\n"
  );
  process.exitCode = result.status || 1;
}
