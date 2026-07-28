const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_LOCKFILES = [
  "app/backend/package-lock.json",
  "app/frontend/package-lock.json",
  "app/frontend/yarn.lock"
];

const findNonPortableRegistryUrls = (text, file) => {
  const violations = [];

  text.split(/\r?\n/).forEach((lineText, index) => {
    const matches = lineText.matchAll(
      /https?:\/\/([a-z0-9.-]+\.replit\.local)(?:\/|["'])/gi
    );
    for (const match of matches) {
      violations.push({
        file,
        line: index + 1,
        host: match[1].toLowerCase()
      });
    }
  });

  return violations;
};

const checkPortableLockfiles = (
  rootDirectory,
  lockfiles = DEFAULT_LOCKFILES
) =>
  lockfiles.flatMap(relativePath => {
    const absolutePath = path.resolve(rootDirectory, relativePath);
    return findNonPortableRegistryUrls(
      fs.readFileSync(absolutePath, "utf8"),
      relativePath
    );
  });

if (require.main === module) {
  const violations = checkPortableLockfiles(
    path.resolve(__dirname, "..")
  );

  if (violations.length > 0) {
    console.error(
      JSON.stringify(
        {
          error: "NON_PORTABLE_LOCKFILE_REGISTRY",
          violations
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  } else {
    console.log("Lockfiles use portable registry URLs.");
  }
}

module.exports = {
  checkPortableLockfiles,
  findNonPortableRegistryUrls
};
