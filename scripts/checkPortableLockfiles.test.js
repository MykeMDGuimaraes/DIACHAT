const assert = require("node:assert/strict");
const test = require("node:test");

const {
  findNonPortableRegistryUrls
} = require("./checkPortableLockfiles");

test("rejects Replit-local registry URLs that break external clean installs", () => {
  const violations = findNonPortableRegistryUrls(
    '{"resolved":"http://package-firewall.replit.local/npm/uuid/-/uuid-8.3.2.tgz"}',
    "package-lock.json"
  );

  assert.deepEqual(violations, [
    {
      file: "package-lock.json",
      line: 1,
      host: "package-firewall.replit.local"
    }
  ]);
});

test("accepts the public npm registry", () => {
  assert.deepEqual(
    findNonPortableRegistryUrls(
      '{"resolved":"https://registry.npmjs.org/uuid/-/uuid-8.3.2.tgz"}',
      "package-lock.json"
    ),
    []
  );
});
