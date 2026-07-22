#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Only run the (expensive) install when node_modules is missing entirely.
if [ ! -d node_modules ]; then
  echo "[replit-start] installing frontend deps..."
  npm install --force --legacy-peer-deps
fi

# Always (re-)apply the post-install patches. These are idempotent and converge
# to the same state, so running them on every startup is cheap and safe. Keeping
# them OUTSIDE the install guard is what makes the build resilient: any later
# in-place `npm install` (updating a single dependency, a `--force` reinstall, or
# an interrupted install) leaves node_modules present but un-patched. If we only
# patched on a fresh node_modules, that would silently drop the patches and the
# build would crash (e.g. react-trello's "(0 , _v.default) is not a function").
echo "[replit-start] verifying/healing post-install patches..."

# Patch 1: Remove eslint-scope's 'exports' field so react-scripts can
# import internal paths like eslint-scope/lib/referencer
node -e "
  const fs = require('fs');
  const pkgPath = 'node_modules/eslint-scope/package.json';
  if (!fs.existsSync(pkgPath)) { console.error('[patch] FATAL: eslint-scope not installed'); process.exit(1); }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.exports) {
    delete pkg.exports;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log('[patch] healed: removed exports restriction from eslint-scope');
  }
"

# Patch 2: Expose uuid/v1 and uuid/v4 subpaths in uuid@11 so react-trello
# (which does require('uuid/v1')) resolves the real functions without
# installing the vulnerable uuid@3. We point the ./v1 and ./v4 exports map
# entries directly at uuid's esm-browser .js dist files. Two gotchas:
#  - Do NOT use .cjs shim files: CRA's webpack file-loader only excludes
#    .js/.mjs/.jsx/.ts/.tsx from asset handling, so a .cjs module is emitted
#    as a static asset and require() returns a URL string instead of the
#    function (crashes react-trello's Board: "(0, _v.default) is not a fn").
#  - Use esm-browser (not dist/cjs): the cjs build imports node's 'crypto'
#    for rng, which CRA5/webpack5 no longer polyfills; esm-browser uses the
#    global Web Crypto API. The dist files expose a proper .default, so
#    react-trello's _interopRequireDefault yields the function.
node -e "
  const fs = require('fs');
  const path = require('path');
  const uuidDir = path.join('node_modules', 'uuid');
  if (!fs.existsSync(uuidDir)) { console.error('[patch] FATAL: uuid not installed'); process.exit(1); }

  // Remove any stale .cjs shims from a previous patch version.
  for (const f of ['v1.cjs', 'v4.cjs']) {
    const p = path.join(uuidDir, f);
    if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('[patch] healed: removed stale uuid/' + f + ' shim'); }
  }

  for (const f of ['dist/esm-browser/v1.js', 'dist/esm-browser/v4.js']) {
    if (!fs.existsSync(path.join(uuidDir, f))) { console.error('[patch] FATAL: expected uuid file missing: ' + f + ' (uuid layout changed?)'); process.exit(1); }
  }

  const pkgPath = path.join(uuidDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.exports || typeof pkg.exports !== 'object') { console.error('[patch] FATAL: uuid package.json has no exports map (uuid layout changed?)'); process.exit(1); }
  const want = {
    './v1': { import: './dist/esm-browser/v1.js', require: './dist/esm-browser/v1.js', default: './dist/esm-browser/v1.js' },
    './v4': { import: './dist/esm-browser/v4.js', require: './dist/esm-browser/v4.js', default: './dist/esm-browser/v4.js' },
  };
  let changed = false;
  for (const k of Object.keys(want)) {
    if (JSON.stringify(pkg.exports[k]) !== JSON.stringify(want[k])) { pkg.exports[k] = want[k]; changed = true; }
  }
  if (changed) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log('[patch] healed: pointed uuid ./v1 and ./v4 exports at real dist files');
  }
"

# Patch 3: fork-ts-checker-webpack-plugin bundles schema-utils@2 which
# at module-load time registers ajv keywords (formatMinimum, formatMaximum)
# that do not exist in ajv-keywords@5 (for ajv@8). Patch validate.js to
# gracefully skip unknown keywords so the process does not crash on startup.
node -e "
  const fs = require('fs');
  const path = 'node_modules/fork-ts-checker-webpack-plugin/node_modules/schema-utils/dist/validate.js';
  if (!fs.existsSync(path)) { console.error('[patch] FATAL: schema-utils/validate.js not found'); process.exit(1); }
  let content = fs.readFileSync(path, 'utf8');
  const oldLine = \"(0, _ajvKeywords.default)(ajv, ['instanceof', 'formatMinimum', 'formatMaximum', 'patternRequired']); // Custom keywords\";
  const newLine = \"['instanceof', 'formatMinimum', 'formatMaximum', 'patternRequired'].forEach(function(k){try{(0, _ajvKeywords.default)(ajv,k);}catch(e){}}); // Custom keywords (graceful degradation for ajv v8 compat)\";
  if (content.includes(oldLine)) {
    fs.writeFileSync(path, content.replace(oldLine, newLine));
    console.log('[patch] healed: patched schema-utils/validate.js for ajv@8 compatibility');
  }
"

# Patch 4: Force the CRA dev-server HMR client to use protocol 'wss' so it never
# tries an insecure ws:// socket. WDS otherwise bakes protocol=ws: because the
# dev server runs over http behind the Replit https proxy; ws:// from an https
# page throws a synchronous SecurityError that Replit's detector reports as a
# frontend crash. ('auto' is not normalized by this WDS client, so use wss.)
node -e "
  const fs = require('fs');
  const path = 'node_modules/react-scripts/config/webpackDevServer.config.js';
  if (!fs.existsSync(path)) { console.error('[patch] FATAL: react-scripts webpackDevServer.config.js not found'); process.exit(1); }
  let content = fs.readFileSync(path, 'utf8');
  const anchor = 'port: sockPort,';
  if (content.includes(anchor) && !content.includes('WDS_SOCKET_PROTOCOL')) {
    content = content.replace(anchor, anchor + \"\n        protocol: process.env.WDS_SOCKET_PROTOCOL || 'wss',\");
    fs.writeFileSync(path, content);
    console.log('[patch] healed: forced CRA HMR websocket protocol to wss');
  }
"

echo "[replit-start] patches verified."

# Modo usado pelo build de produção (scripts/deploy-build.sh): aplica apenas os
# patches de node_modules e sai, sem subir o dev server.
if [ "${1:-}" = "--patches-only" ]; then
  exit 0
fi

export HOST=0.0.0.0
export PORT=5000
export DANGEROUSLY_DISABLE_HOST_CHECK=true
export BROWSER=none
export NODE_OPTIONS="--openssl-legacy-provider ${NODE_OPTIONS:-}"

echo "[replit-start] starting CRA dev server on :$PORT..."
exec npm start
