const fs = require("fs");
const path = require("path");

const sourceRoot = path.resolve(__dirname, "../src");
const baileysAdapter = path.join(
  sourceRoot,
  "messaging",
  "adapters",
  "baileys"
);
const metaAdapter = path.join(
  sourceRoot,
  "messaging",
  "adapters",
  "meta-cloud"
);

const walk = directory =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });

const stripComments = source =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const violations = [];

for (const file of walk(sourceRoot)) {
  if (file.startsWith(baileysAdapter)) continue;

  const relative = path.relative(sourceRoot, file).replace(/\\/g, "/");
  const source = stripComments(fs.readFileSync(file, "utf8"));

  if (
    /(?:from\s+|require\s*\()\s*["'](?:@adiwajshing\/)?baileys(?:\/[^"']*)?["']/.test(
      source
    )
  ) {
    violations.push(
      `${relative}: importe Baileys somente por messaging/adapters/baileys`
    );
  }

  if (!file.startsWith(metaAdapter) && /\.sendMessage\s*\(/.test(source)) {
    violations.push(
      `${relative}: envie mensagens somente pela porta de mensageria`
    );
  }
}

if (violations.length) {
  console.error("Messaging boundary violations:\n");
  violations.forEach(violation => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Messaging boundaries are valid.");
