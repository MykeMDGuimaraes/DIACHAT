#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d node_modules ]; then
  echo "[replit-start] installing frontend deps..."
  npm install --force --legacy-peer-deps

  echo "[replit-start] applying post-install patches..."

  # Patch 1: Remove eslint-scope's 'exports' field so react-scripts can
  # import internal paths like eslint-scope/lib/referencer
  node -e "
    const fs = require('fs');
    const pkgPath = 'node_modules/eslint-scope/package.json';
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.exports) {
      delete pkg.exports;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      console.log('[patch] removed exports restriction from eslint-scope');
    }
  "

  # Patch 2: Create uuid/v1 and uuid/v4 CJS compatibility shims in uuid@11
  # so react-trello (which uses require('uuid/v1')) works without installing
  # the vulnerable uuid@3. uuid@11 ships CJS builds in dist/cjs/ that export
  # the v1/v4 functions as .default. We expose them via .cjs shim files and
  # add ./v1 and ./v4 entries to uuid's exports map.
  node -e "
    const fs = require('fs');
    const path = require('path');
    const uuidDir = path.join('node_modules', 'uuid');
    const v1Cjs = path.join(uuidDir, 'v1.cjs');
    const v4Cjs = path.join(uuidDir, 'v4.cjs');

    if (!fs.existsSync(v1Cjs)) {
      fs.writeFileSync(v1Cjs, '\"use strict\";\nmodule.exports = require(\"./dist/cjs/v1.js\").default;\n');
      console.log('[patch] created uuid/v1.cjs shim');
    }
    if (!fs.existsSync(v4Cjs)) {
      fs.writeFileSync(v4Cjs, '\"use strict\";\nmodule.exports = require(\"./dist/cjs/v4.js\").default;\n');
      console.log('[patch] created uuid/v4.cjs shim');
    }

    const pkgPath = path.join(uuidDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    let changed = false;
    if (!pkg.exports['./v1']) { pkg.exports['./v1'] = { require: './v1.cjs' }; changed = true; }
    if (!pkg.exports['./v4']) { pkg.exports['./v4'] = { require: './v4.cjs' }; changed = true; }
    if (changed) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      console.log('[patch] added ./v1 and ./v4 to uuid exports map');
    }
  "

  # Patch 3: fork-ts-checker-webpack-plugin bundles schema-utils@2 which
  # at module-load time registers ajv keywords (formatMinimum, formatMaximum)
  # that do not exist in ajv-keywords@5 (for ajv@8). Patch validate.js to
  # gracefully skip unknown keywords so the process does not crash on startup.
  node -e "
    const fs = require('fs');
    const path = 'node_modules/fork-ts-checker-webpack-plugin/node_modules/schema-utils/dist/validate.js';
    let content = fs.readFileSync(path, 'utf8');
    const oldLine = \"(0, _ajvKeywords.default)(ajv, ['instanceof', 'formatMinimum', 'formatMaximum', 'patternRequired']); // Custom keywords\";
    const newLine = \"['instanceof', 'formatMinimum', 'formatMaximum', 'patternRequired'].forEach(function(k){try{(0, _ajvKeywords.default)(ajv,k);}catch(e){}}); // Custom keywords (graceful degradation for ajv v8 compat)\";
    if (content.includes(oldLine)) {
      fs.writeFileSync(path, content.replace(oldLine, newLine));
      console.log('[patch] patched schema-utils/validate.js for ajv@8 compatibility');
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
    let content = fs.readFileSync(path, 'utf8');
    const anchor = 'port: sockPort,';
    if (content.includes(anchor) && !content.includes('WDS_SOCKET_PROTOCOL')) {
      content = content.replace(anchor, anchor + \"\n        protocol: process.env.WDS_SOCKET_PROTOCOL || 'wss',\");
      fs.writeFileSync(path, content);
      console.log('[patch] forced CRA HMR websocket protocol to wss');
    }
  "

  echo "[replit-start] patches applied."
fi

export HOST=0.0.0.0
export PORT=5000
export DANGEROUSLY_DISABLE_HOST_CHECK=true
export BROWSER=none
export NODE_OPTIONS="--openssl-legacy-provider ${NODE_OPTIONS:-}"

echo "[replit-start] starting CRA dev server on :$PORT..."
exec npm start
